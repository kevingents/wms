import { query, queryOne, BoekingsFout } from "./db";
import { startPicken, type PickOpdracht } from "./picken";
import { instelling } from "./instellingen";

/**
 * Pickrondes — batchpicken met bakken.
 *
 * HOE HET MAGAZIJN ECHT WERKT
 * ---------------------------
 * Webshoporders worden eerst verzameld tot één ronde. Elke order krijgt een
 * genummerde bak op de kar. De picker loopt het magazijn ÉÉN keer door: bij elk
 * vak pakt hij het totaal voor alle orders samen en verdeelt dat over de bakken.
 * Aan het eind bevat elke bak precies één order, klaar voor inpakken.
 *
 * Tien orders van twee regels zijn zo één ronde in plaats van tien rondes. Het
 * loopwerk is de kostenpost, niet het grijpen — daarom is dit de belangrijkste
 * winst in het hele pickproces.
 *
 * EEN LAAG ERBOVENOP, GEEN VERVANGING
 * -----------------------------------
 * Een ronde groepeert bestaande pickopdrachten; de regels, de toewijzing en het
 * grootboek blijven ongewijzigd. Bevestigen loopt nog steeds per pickregel via
 * `bevestigPickRegel`. Een ronde is alleen een andere volgorde om erdoorheen te
 * lopen — en dus kan een order ook los gepikt worden als dat beter uitkomt.
 */

export interface Ronde {
  id: number;
  code: string;
  status: "open" | "bezig" | "gepikt" | "afgesloten" | "geannuleerd";
  gestart_naam: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  bakken: number;
  stops: number;
  regels: number;
  open_regels: number;
  stuks: number;
}

export interface RondeBak {
  bak: number;
  pick_order_id: number;
  opdracht_code: string;
  bestemming: string | null;
  regels: number;
  gepikt: number;
  gevraagd: number;
}

/** Eén stop op de looproute: één vak, één artikel, verdeeld over bakken. */
export interface RondeStop {
  location_id: number | null;
  location_code: string | null;
  zone: string | null;
  sort_order: number;
  sku: string;
  omschrijving: string | null;
  merk: string | null;
  maat: string | null;
  kleur: string | null;
  barcode: string | null;
  totaal: number;
  totaalGepikt: number;
  klaar: boolean;
  bakken: {
    bak: number;
    regel_id: number;
    opdracht_code: string;
    bestemming: string | null;
    gevraagd: number;
    gepikt: number;
    status: string;
  }[];
}

/* ── Lezen ─────────────────────────────────────────────────────────────────── */

const RONDE_SELECT = `
  SELECT r.*,
         (SELECT count(*) FROM wms.pick_ronde_orders ro WHERE ro.ronde_id = r.id)::int AS bakken,
         (SELECT count(DISTINCT (s.location_id, s.sku)) FROM wms.ronde_stops s
           WHERE s.ronde_id = r.id)::int                                               AS stops,
         (SELECT count(*) FROM wms.ronde_stops s WHERE s.ronde_id = r.id)::int          AS regels,
         (SELECT count(*) FROM wms.ronde_stops s
           WHERE s.ronde_id = r.id AND s.status = 'open')::int                          AS open_regels,
         (SELECT coalesce(sum(s.gevraagd), 0) FROM wms.ronde_stops s
           WHERE s.ronde_id = r.id)::int                                                AS stuks
    FROM wms.pick_rondes r`;

export async function openRondes(): Promise<Ronde[]> {
  return query<Ronde>(
    `${RONDE_SELECT} WHERE r.status IN ('open', 'bezig') ORDER BY r.created_at`
  );
}

export async function ronde(id: number): Promise<Ronde | null> {
  return queryOne<Ronde>(`${RONDE_SELECT} WHERE r.id = $1`, [id]);
}

export async function rondeBakken(rondeId: number): Promise<RondeBak[]> {
  return query<RondeBak>(
    `SELECT ro.bak, ro.pick_order_id, po.code AS opdracht_code, po.bestemming,
            count(l.id)::int                      AS regels,
            coalesce(sum(l.gepikt), 0)::int       AS gepikt,
            coalesce(sum(l.gevraagd), 0)::int     AS gevraagd
       FROM wms.pick_ronde_orders ro
       JOIN wms.pick_orders po ON po.id = ro.pick_order_id
       LEFT JOIN wms.pick_lines l ON l.pick_order_id = ro.pick_order_id
      WHERE ro.ronde_id = $1
      GROUP BY ro.bak, ro.pick_order_id, po.code, po.bestemming
      ORDER BY ro.bak`,
    [rondeId]
  );
}

/**
 * De looplijst. Eén rij per (vak × artikel), met daaronder de verdeling over
 * bakken — precies wat de picker bij een stop moet weten: hoeveel pakken, en
 * waar verdelen.
 *
 * Afgeronde stops zakken naar onder in plaats van te verdwijnen: een picker wil
 * kunnen terugkijken wat hij net gedaan heeft.
 */
export async function rondeStops(rondeId: number): Promise<RondeStop[]> {
  const rijen = await query<{
    location_id: number | null;
    location_code: string | null;
    zone: string | null;
    sort_order: number;
    sku: string;
    omschrijving: string | null;
    merk: string | null;
    maat: string | null;
    kleur: string | null;
    barcode: string | null;
    bak: number;
    regel_id: number;
    opdracht_code: string;
    bestemming: string | null;
    gevraagd: number;
    gepikt: number;
    status: string;
  }>(
    `SELECT s.location_id, s.location_code, s.zone,
            coalesce(s.sort_order, 0) AS sort_order,
            s.sku, a.omschrijving, a.merk, a.maat, a.kleur, a.barcode,
            s.bak, s.regel_id, s.opdracht_code, s.bestemming,
            s.gevraagd, s.gepikt, s.status
       FROM wms.ronde_stops s
       LEFT JOIN wms.artikelen a ON a.sku = s.sku
      WHERE s.ronde_id = $1
      ORDER BY coalesce(s.sort_order, 0), s.location_code, s.sku, s.bak`,
    [rondeId]
  );

  const stops = new Map<string, RondeStop>();
  for (const r of rijen) {
    const sleutel = `${r.location_id ?? "geen"}|${r.sku}`;
    let stop = stops.get(sleutel);
    if (!stop) {
      stop = {
        location_id: r.location_id,
        location_code: r.location_code,
        zone: r.zone,
        sort_order: Number(r.sort_order),
        sku: r.sku,
        omschrijving: r.omschrijving,
        merk: r.merk,
        maat: r.maat,
        kleur: r.kleur,
        barcode: r.barcode,
        totaal: 0,
        totaalGepikt: 0,
        klaar: true,
        bakken: [],
      };
      stops.set(sleutel, stop);
    }
    stop.totaal += Number(r.gevraagd);
    stop.totaalGepikt += Number(r.gepikt);
    if (r.status === "open") stop.klaar = false;
    stop.bakken.push({
      bak: r.bak,
      regel_id: r.regel_id,
      opdracht_code: r.opdracht_code,
      bestemming: r.bestemming,
      gevraagd: Number(r.gevraagd),
      gepikt: Number(r.gepikt),
      status: r.status,
    });
  }

  const lijst = [...stops.values()];
  lijst.forEach((s) => s.bakken.sort((a, b) => a.bak - b.bak));
  /* Openstaande stops eerst, daarbinnen op looproute. */
  return lijst.sort(
    (a, b) =>
      Number(a.klaar) - Number(b.klaar) ||
      a.sort_order - b.sort_order ||
      (a.location_code ?? "").localeCompare(b.location_code ?? "")
  );
}

/* ── Samenstellen ──────────────────────────────────────────────────────────── */

async function nieuweCode(): Promise<string> {
  const rij = await queryOne<{ n: string }>(
    `SELECT nextval('wms.pick_ronde_nummer')::text AS n`
  );
  return `R-${String(rij?.n ?? "0").padStart(5, "0")}`;
}

/**
 * Stelt een ronde samen uit openstaande pickopdrachten.
 *
 * Opdrachten die al in een andere ronde zitten worden overgeslagen — dat is de
 * unieke index, niet iets wat we hier hoeven te controleren, maar we melden het
 * wel terug zodat de teamleider ziet waarom er eentje ontbreekt.
 */
export async function maakRonde(args: {
  pickOrderIds: number[];
  door: string | null;
  doorNaam: string | null;
  note?: string | null;
}): Promise<{ ronde: Ronde; overgeslagen: number[] }> {
  const maxBakken = Number(await instelling<number>("picken.bakken_per_kar")) || 12;

  if (args.pickOrderIds.length === 0) {
    throw new BoekingsFout("Kies minstens één opdracht voor de ronde.", "leeg");
  }
  if (args.pickOrderIds.length > maxBakken) {
    throw new BoekingsFout(
      `Er passen ${maxBakken} bakken op een kar. Kies er niet meer dan dat, of pas de instelling aan.`,
      "te_veel_bakken"
    );
  }

  const code = await nieuweCode();
  const nieuw = await queryOne<{ id: number }>(
    `INSERT INTO wms.pick_rondes (code, gestart_door, gestart_naam, note)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [code, args.door, args.doorNaam, args.note ?? null]
  );
  if (!nieuw) throw new BoekingsFout("Ronde niet aangemaakt.", "mislukt");

  const overgeslagen: number[] = [];
  let bak = 0;

  for (const pickOrderId of args.pickOrderIds) {
    bak += 1;
    const gekoppeld = await queryOne<{ bak: number }>(
      `INSERT INTO wms.pick_ronde_orders (ronde_id, pick_order_id, bak)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING bak`,
      [nieuw.id, pickOrderId, bak]
    );
    if (!gekoppeld) {
      overgeslagen.push(pickOrderId);
      bak -= 1; /* baknummers aaneengesloten houden */
    }
  }

  if (bak === 0) {
    await query(`DELETE FROM wms.pick_rondes WHERE id = $1`, [nieuw.id]);
    throw new BoekingsFout(
      "Al deze opdrachten zitten al in een andere ronde.",
      "allemaal_bezet"
    );
  }

  const gemaakt = await ronde(nieuw.id);
  return { ronde: gemaakt!, overgeslagen };
}

/** Start de ronde: alle opdrachten erin gaan op 'bezig' en op naam. */
export async function startRonde(
  id: number,
  userId: string,
  naam: string
): Promise<Ronde | null> {
  await query(
    `UPDATE wms.pick_rondes
        SET status = 'bezig', started_at = coalesce(started_at, now()),
            gestart_door = $2, gestart_naam = $3
      WHERE id = $1 AND status IN ('open', 'bezig')`,
    [id, userId, naam]
  );

  const orders = await query<{ pick_order_id: number }>(
    `SELECT pick_order_id FROM wms.pick_ronde_orders WHERE ronde_id = $1`,
    [id]
  );
  for (const o of orders) {
    await startPicken(o.pick_order_id, userId, naam);
  }

  return ronde(id);
}

/**
 * Rondt de ronde af zodra alle regels behandeld zijn. De opdrachten zelf zijn
 * dan al op 'gepikt' gezet door `bevestigPickRegel`; hier volgt alleen de
 * ronde-status. Verzenden blijft per opdracht, want elke bak gaat naar een eigen
 * bestemming.
 */
export async function werkRondeStatusBij(rondeId: number): Promise<void> {
  await query(
    `UPDATE wms.pick_rondes r
        SET status = 'gepikt', finished_at = now()
      WHERE r.id = $1
        AND r.status = 'bezig'
        AND NOT EXISTS (
          SELECT 1 FROM wms.ronde_stops s
           WHERE s.ronde_id = r.id AND s.status = 'open'
        )`,
    [rondeId]
  );
}

/** In welke ronde zit deze opdracht, als hij ergens in zit? */
export async function rondeVanOpdracht(pickOrderId: number): Promise<number | null> {
  const rij = await queryOne<{ ronde_id: number }>(
    `SELECT ronde_id FROM wms.pick_ronde_orders WHERE pick_order_id = $1`,
    [pickOrderId]
  );
  return rij?.ronde_id ?? null;
}

export type { PickOpdracht };
