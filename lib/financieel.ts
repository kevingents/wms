import { query, queryOne, BoekingsFout } from "./db";
import { backendJson, backendBase } from "./backend";

/**
 * Financiële laag — de voorraad in euro's.
 *
 * WAAROM DIT ERBIJ HOORT
 * ----------------------
 * Een magazijn dat meetelt in de jaarrekening moet aansluiten op het grootboek.
 * Zolang het WMS alleen stuks telt, blijft bij elke afsluiting dezelfde vraag
 * open: welk getal klopt, dat van de vloer of dat van de boekhouding? De enige
 * manier om die vraag te laten verdwijnen is elke mutatie een waarde geven op
 * het moment dat hij geboekt wordt, en die waarde nooit meer aanraken.
 *
 * Daarmee geldt altijd:  waarde in − waarde uit = voorraadwaarde.
 * Dat is één query, en die staat op /financieel.
 *
 * WAARDERING: VOORTSCHRIJDEND GEMIDDELDE
 * --------------------------------------
 * Zie de toelichting in db/schema-3.sql. Kort: FIFO vraagt kostlagen per
 * ontvangst en de kostprijsbron levert één prijs per artikel. Een FIFO-
 * administratie op geschatte lagen is schijnnauwkeurigheid.
 *
 * FIFO blijft wél de fysieke regel op de vloer — oudste eerst pikken. Waardering
 * en rotatie zijn twee dingen en hoeven niet gelijk te zijn.
 */

export interface Sluitcontrole {
  waarde_in_cent: number;
  waarde_uit_cent: number;
  waarde_op_voorraad_cent: number;
  verschil_cent: number;
  sluit: boolean;
}

/**
 * De kernvraag: klopt de administratie met zichzelf?
 *
 * Een verschil hier betekent dat er voorraad is gemuteerd buiten de trigger om.
 * Dat kan alleen door direct in de database te schrijven, en dan is er iets
 * fundamenteel mis — dus dit hoort altijd nul te zijn, niet "ongeveer nul".
 */
export async function sluitcontrole(): Promise<Sluitcontrole> {
  const rij = await queryOne<Record<string, string>>(
    `SELECT waarde_in_cent::text, waarde_uit_cent::text,
            waarde_op_voorraad_cent::text, verschil_cent::text
       FROM wms.waarde_sluitcontrole`
  );
  const verschil = Number(rij?.verschil_cent ?? 0);
  return {
    waarde_in_cent: Number(rij?.waarde_in_cent ?? 0),
    waarde_uit_cent: Number(rij?.waarde_uit_cent ?? 0),
    waarde_op_voorraad_cent: Number(rij?.waarde_op_voorraad_cent ?? 0),
    verschil_cent: verschil,
    sluit: verschil === 0,
  };
}

export interface GrootboekBalans {
  jaar: number;
  maand: number;
  debet_cent: number;
  credit_cent: number;
  verschil_cent: number;
  regels: number;
  verstuurd: number;
}

/** Dubbel boekhouden: debet min credit hoort per periode nul te zijn. */
export async function grootboekBalans(): Promise<GrootboekBalans[]> {
  return query<GrootboekBalans>(
    `SELECT * FROM wms.grootboek_balans ORDER BY jaar DESC, maand DESC LIMIT 24`
  );
}

export interface ZoneWaarde {
  zone: string;
  skus: number;
  stuks: number;
  waarde_cent: number;
}

export async function waardePerZone(): Promise<ZoneWaarde[]> {
  return query<ZoneWaarde>(
    `SELECT zone, skus, stuks, coalesce(waarde_cent, 0)::bigint AS waarde_cent
       FROM wms.waarde_per_zone ORDER BY waarde_cent DESC NULLS LAST`
  );
}

export interface OntbrekendeWaarde {
  sku: string;
  stuks: number;
  locaties: number;
  omschrijving: string | null;
}

/**
 * Voorraad zonder kostprijs. Elk artikel in deze lijst is een gat in de
 * waardering: het ligt er wel, maar telt voor nul euro mee. Dit is het eerste
 * wat je oplost voordat je de voorraadwaarde ergens op baseert.
 */
export async function ontbrekendeWaarde(limiet = 100): Promise<OntbrekendeWaarde[]> {
  return query<OntbrekendeWaarde>(
    `SELECT w.*, a.omschrijving
       FROM wms.waarde_ontbreekt w
       LEFT JOIN wms.artikelen a ON a.sku = w.sku
      ORDER BY w.stuks DESC
      LIMIT $1`,
    [limiet]
  );
}

export interface Periode {
  jaar: number;
  maand: number;
  status: "open" | "afgesloten";
  afgesloten_door: string | null;
  afgesloten_at: string | null;
  waarde_eind_cent: number | null;
  mutaties: number;
  waarde_in_cent: number;
  waarde_uit_cent: number;
}

/**
 * Perioden met hun mutaties. Maanden zonder rij in `wms.perioden` zijn open —
 * die verschijnen hier ook, met status 'open', zodat je niet eerst iets hoeft
 * aan te maken om te kunnen afsluiten.
 */
export async function perioden(aantal = 12): Promise<Periode[]> {
  return query<Periode>(
    `WITH maanden AS (
       SELECT extract(year FROM d)::int AS jaar, extract(month FROM d)::int AS maand
         FROM generate_series(
                date_trunc('month', now()) - ($1 || ' months')::interval,
                date_trunc('month', now()),
                interval '1 month') d
     ), mutaties AS (
       SELECT extract(year FROM created_at)::int  AS jaar,
              extract(month FROM created_at)::int AS maand,
              count(*)::int                        AS mutaties,
              coalesce(sum(waarde_cent) FILTER (WHERE from_location_id IS NULL), 0) AS waarde_in,
              coalesce(sum(waarde_cent) FILTER (WHERE to_location_id IS NULL), 0)   AS waarde_uit
         FROM wms.stock_moves
        GROUP BY 1, 2
     )
     SELECT m.jaar, m.maand,
            coalesce(p.status, 'open')            AS status,
            p.afgesloten_door, p.afgesloten_at, p.waarde_eind_cent,
            coalesce(x.mutaties, 0)               AS mutaties,
            coalesce(x.waarde_in, 0)::bigint      AS waarde_in_cent,
            coalesce(x.waarde_uit, 0)::bigint     AS waarde_uit_cent
       FROM maanden m
       LEFT JOIN wms.perioden p ON p.jaar = m.jaar AND p.maand = m.maand
       LEFT JOIN mutaties x ON x.jaar = m.jaar AND x.maand = m.maand
      ORDER BY m.jaar DESC, m.maand DESC`,
    [String(aantal)]
  );
}

/**
 * Sluit een periode af. Daarna kan er niets meer in geboekt worden — de trigger
 * weigert het. Dat is het punt: zonder slot kan een boeking van vandaag de
 * cijfers van vorige maand veranderen nadat de accountant ernaar keek.
 *
 * De eindwaarde wordt vastgelegd, zodat later te controleren is of de stand van
 * toen nog klopt met wat het systeem nu zegt.
 */
export async function sluitPeriode(args: {
  jaar: number;
  maand: number;
  door: string;
}): Promise<Periode | null> {
  const nu = new Date();
  const huidigJaar = nu.getFullYear();
  const huidigeMaand = nu.getMonth() + 1;

  if (
    args.jaar > huidigJaar ||
    (args.jaar === huidigJaar && args.maand > huidigeMaand)
  ) {
    throw new BoekingsFout(
      "Een periode in de toekomst afsluiten kan niet.",
      "toekomst"
    );
  }

  const controle = await sluitcontrole();
  if (!controle.sluit) {
    throw new BoekingsFout(
      `De voorraadwaarde sluit niet (verschil ${(controle.verschil_cent / 100).toFixed(2)}). Los dat eerst op — een periode afsluiten op een verschil maakt het permanent.`,
      "sluit_niet"
    );
  }

  const waarde = await queryOne<{ n: string }>(
    `SELECT coalesce(sum(waarde_cent), 0)::text AS n FROM wms.artikel_waarde`
  );

  await query(
    `INSERT INTO wms.perioden (jaar, maand, status, afgesloten_door, afgesloten_at, waarde_eind_cent)
     VALUES ($1, $2, 'afgesloten', $3, now(), $4)
     ON CONFLICT (jaar, maand) DO UPDATE
       SET status = 'afgesloten', afgesloten_door = excluded.afgesloten_door,
           afgesloten_at = now(), waarde_eind_cent = excluded.waarde_eind_cent`,
    [args.jaar, args.maand, args.door, Number(waarde?.n ?? 0)]
  );

  const lijst = await perioden(24);
  return lijst.find((p) => p.jaar === args.jaar && p.maand === args.maand) ?? null;
}

export async function heropenPeriode(args: {
  jaar: number;
  maand: number;
  door: string;
  reden: string;
}): Promise<void> {
  await query(
    `UPDATE wms.perioden
        SET status = 'open', note = coalesce(note, '') || ' | heropend door ' || $3 || ': ' || $4
      WHERE jaar = $1 AND maand = $2`,
    [args.jaar, args.maand, args.door, args.reden]
  );
}

/* ── Kostprijzen ───────────────────────────────────────────────────────────── */

export interface Kostprijs {
  sku: string;
  kostprijs_cent: number;
  bron: string;
  geldig_vanaf: string;
}

export async function zetKostprijs(args: {
  sku: string;
  kostprijsCent: number;
  bron?: string;
  door: string | null;
  note?: string | null;
}): Promise<void> {
  if (!Number.isInteger(args.kostprijsCent) || args.kostprijsCent < 0) {
    throw new BoekingsFout("Kostprijs moet 0 of hoger zijn, in centen.", "ongeldig");
  }
  await query(
    `INSERT INTO wms.kostprijzen (sku, kostprijs_cent, bron, ingevoerd_door, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [args.sku.trim(), args.kostprijsCent, args.bron ?? "handmatig", args.door, args.note ?? null]
  );
}

export interface KostprijsImport {
  gevonden: number;
  gezet: number;
  overgeslagen: number;
  bron: string;
}

interface CostAntwoord {
  success?: boolean;
  bySku?: Record<string, { kostprijs?: number }>;
  message?: string;
}

/**
 * Haalt de kostprijzen op bij storegents.
 *
 * Die staan daar al: opgebouwd uit de SRS-verkopen-export (kolom `kostprijs`,
 * ex-btw, per EAN). We nemen ze over in plaats van ze na te rekenen — dezelfde
 * regel als bij het pickwerk: de portal rekent, het WMS voert uit.
 *
 * Alleen artikelen waarvan de prijs veranderd is krijgen een nieuwe rij, zodat
 * de historie leesbaar blijft en niet elke import duizenden identieke regels
 * toevoegt.
 */
export async function importeerKostprijzen(door: string | null): Promise<KostprijsImport> {
  if (!backendBase() || !process.env.ADMIN_TOKEN) {
    throw new BoekingsFout(
      "BACKEND_API_BASE of ADMIN_TOKEN ontbreekt — kostprijzen kunnen niet opgehaald worden.",
      "geen_backend"
    );
  }

  const { ok, status, data } = await backendJson<CostAntwoord>(
    "api/admin/product-cost",
    { method: "GET" },
    true
  );

  if (!ok || !data?.bySku) {
    throw new BoekingsFout(
      data?.message ||
        `storegents gaf status ${status}. Bestaat /api/admin/product-cost daar al?`,
      "backend_fout"
    );
  }

  const huidig = new Map(
    (await query<{ sku: string; kostprijs_cent: number }>(
      `SELECT sku, kostprijs_cent FROM wms.kostprijs_actueel`
    )).map((r) => [r.sku, Number(r.kostprijs_cent)])
  );

  const entries = Object.entries(data.bySku);
  let gezet = 0;
  let overgeslagen = 0;
  const BATCH = 500;
  const nieuw: { sku: string; cent: number }[] = [];

  for (const [ean, waarde] of entries) {
    const euro = Number(waarde?.kostprijs);
    if (!Number.isFinite(euro) || euro <= 0) {
      overgeslagen += 1;
      continue;
    }
    const cent = Math.round(euro * 100);
    if (huidig.get(ean) === cent) {
      overgeslagen += 1;
      continue;
    }
    nieuw.push({ sku: ean, cent });
  }

  for (let i = 0; i < nieuw.length; i += BATCH) {
    const stuk = nieuw.slice(i, i + BATCH);
    const params: unknown[] = [];
    const groepen: string[] = [];
    /* Alles als parameter, ook de naam — die komt uit een sessie maar hoort
       evengoed niet in een querystring geplakt te worden. */
    stuk.forEach((r, j) => {
      groepen.push(`($${j * 3 + 1}, $${j * 3 + 2}, 'srs', $${j * 3 + 3})`);
      params.push(r.sku, r.cent, door);
    });
    await query(
      `INSERT INTO wms.kostprijzen (sku, kostprijs_cent, bron, ingevoerd_door)
       VALUES ${groepen.join(", ")}`,
      params
    );
    gezet += stuk.length;
  }

  return { gevonden: entries.length, gezet, overgeslagen, bron: "srs" };
}

/* ── ABC / slotting ────────────────────────────────────────────────────────── */

export interface ArtikelKlasse {
  sku: string;
  keer: number;
  stuks: number;
  cumulatief_pct: number;
  klasse: "A" | "B" | "C";
  omschrijving: string | null;
  locaties: string | null;
  gem_sort_order: number | null;
}

/**
 * Slotting-advies: hardlopers die achterin liggen.
 *
 * A-artikelen zijn samen 80% van het pickvolume. Liggen die achterin het
 * magazijn, dan loopt de picker dat traject elke dag opnieuw. Dit is het enige
 * optimalisatie-advies dat het WMS zelf geeft, want het is puur een functie van
 * pickhistorie en looproute — allebei dingen die alleen hier bekend zijn.
 */
export async function slottingAdvies(limiet = 30): Promise<ArtikelKlasse[]> {
  return query<ArtikelKlasse>(
    `WITH ligging AS (
       SELECT s.sku,
              string_agg(l.code, ', ' ORDER BY l.sort_order) AS locaties,
              avg(l.sort_order)::int                          AS gem_sort_order
         FROM wms.stock_levels s
         JOIN wms.locations l ON l.id = s.location_id
        WHERE s.qty > 0 AND l.kind IN ('pick', 'bulk')
        GROUP BY s.sku
     ), mediaan AS (
       SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY sort_order) AS midden
         FROM wms.locations WHERE active AND kind IN ('pick', 'bulk')
     )
     SELECT k.sku, k.keer, k.stuks, k.cumulatief_pct, k.klasse,
            a.omschrijving, g.locaties, g.gem_sort_order
       FROM wms.artikel_klasse k
       LEFT JOIN wms.artikelen a ON a.sku = k.sku
       LEFT JOIN ligging g ON g.sku = k.sku
      WHERE k.klasse = 'A'
        AND g.gem_sort_order > (SELECT midden FROM mediaan)
      ORDER BY k.stuks DESC
      LIMIT $1`,
    [limiet]
  );
}
