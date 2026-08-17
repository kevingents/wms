import { query, queryOne, BoekingsFout, vertaalDbFout } from "./db";
import { boekMutatie, zoekLocatie } from "./voorraad";
import { instelling } from "./instellingen";

/**
 * Picken — het uitgaande werk van het magazijn.
 *
 * Waar het werk vandaan komt:
 *   weborder — `public.orders.fulfillment_plan` bevat `shipments[]`, elk met een
 *              `branchId`. Alles met branchId '99' (of `isWarehouse`) is voor
 *              het magazijn. De core doet de toewijzing winkel-vs-magazijn al;
 *              wij nemen die over, we bedenken 'm niet opnieuw.
 *   transfer — `public.inbound_shipments` met `from_location` = magazijn.
 *
 * De import is idempotent via UNIQUE (bron, bron_ref): dezelfde order twee keer
 * importeren levert geen tweede pickopdracht op.
 *
 * Toewijzing is advies, geen reservering. De voorraad blijft op zijn plek tot er
 * echt gepikt wordt; `wms.vrije_voorraad` trekt alleen af wat al aan open picks
 * is toegezegd, zodat twee pickers niet naar dezelfde vier stuks worden
 * gestuurd. Ligt het er onverhoopt niet, dan meldt de picker 'kort' en wijzen we
 * de rest opnieuw toe.
 */

/**
 * Waar het werk vandaan komt. De portal-modellen (herverdeling, forecast,
 * aanvulling, inkoop) leveren allemaal via dezelfde deur af; alleen dit label
 * verschilt. Houd deze lijst gelijk aan pick_orders_bron_chk in db/schema.sql.
 */
export type PickBron =
  | "weborder"
  | "transfer"
  | "aanvulling"
  | "herverdeling"
  | "forecast"
  | "inkoop"
  | "handmatig";

export interface PickOpdracht {
  id: number;
  code: string;
  bron: PickBron;
  bron_ref: string;
  bestemming: string | null;
  prioriteit: number;
  status: "open" | "bezig" | "gepikt" | "afgesloten" | "geannuleerd";
  toegewezen_naam: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  regels: number;
  open_regels: number;
  stuks: number;
  /** Open regels waaraan geen voorraad toegewezen kon worden. */
  zonder_locatie: number;
}

export interface PickRegel {
  id: number;
  pick_order_id: number;
  sku: string;
  gevraagd: number;
  gepikt: number;
  location_id: number | null;
  location_code: string | null;
  zone: string | null;
  volgorde: number;
  status: "open" | "gepikt" | "kort" | "overgeslagen";
  note: string | null;
  omschrijving: string | null;
  merk: string | null;
  maat: string | null;
  kleur: string | null;
  barcode: string | null;
}

/* ── Lezen ─────────────────────────────────────────────────────────────────── */

/**
 * `zonder_locatie` is er zodat een teamleider ziet dat een opdracht niet
 * gelopen kan worden vóórdat iemand met een kar op pad gaat. Een regel zonder
 * locatie betekent dat er geen vrije voorraad aan toegewezen kon worden; de
 * picker zou bij die regel stilvallen en dat is precies waar tijd verdampt.
 */
const OPDRACHT_SELECT = `
  SELECT o.*,
         (SELECT count(*) FROM wms.pick_lines l WHERE l.pick_order_id = o.id)::int AS regels,
         (SELECT count(*) FROM wms.pick_lines l
           WHERE l.pick_order_id = o.id AND l.status = 'open')::int AS open_regels,
         (SELECT count(*) FROM wms.pick_lines l
           WHERE l.pick_order_id = o.id AND l.status = 'open'
             AND l.location_id IS NULL)::int AS zonder_locatie,
         (SELECT coalesce(sum(l.gevraagd), 0) FROM wms.pick_lines l
           WHERE l.pick_order_id = o.id)::int AS stuks
    FROM wms.pick_orders o`;

export async function werkvoorraad(): Promise<PickOpdracht[]> {
  return query<PickOpdracht>(
    `${OPDRACHT_SELECT}
      WHERE o.status IN ('open', 'bezig')
      ORDER BY o.prioriteit DESC, o.created_at`
  );
}

export async function pickOpdracht(id: number): Promise<PickOpdracht | null> {
  return queryOne<PickOpdracht>(`${OPDRACHT_SELECT} WHERE o.id = $1`, [id]);
}

export async function pickRegels(pickOrderId: number): Promise<PickRegel[]> {
  return query<PickRegel>(
    `SELECT l.*, loc.code AS location_code, loc.zone,
            a.omschrijving, a.merk, a.maat, a.kleur, a.barcode
       FROM wms.pick_lines l
       LEFT JOIN wms.locations loc ON loc.id = l.location_id
       LEFT JOIN wms.artikelen a ON a.sku = l.sku
      WHERE l.pick_order_id = $1
      ORDER BY (l.status <> 'open'), l.volgorde, l.id`,
    [pickOrderId]
  );
}

/* ── Toewijzen ─────────────────────────────────────────────────────────────── */

interface Toewijzing {
  location_id: number;
  sort_order: number;
  aantal: number;
}

/**
 * Kiest locaties voor een aantal stuks van één sku.
 *
 * Volgorde van voorkeur: piklocaties eerst (daar hoort de picker te lopen), en
 * daarbinnen de locatie met de meeste vrije voorraad — dat levert de minste
 * losse regels op. Wat niet toegewezen kan worden komt terug als `tekort`; die
 * regel krijgt geen locatie en is meteen zichtbaar als probleem.
 */
async function kiesLocaties(
  sku: string,
  nodig: number
): Promise<{ toewijzingen: Toewijzing[]; tekort: number }> {
  const kandidaten = await query<{ location_id: number; sort_order: number; vrij: number }>(
    `SELECT location_id, sort_order, vrij
       FROM wms.vrije_voorraad
      WHERE sku = $1 AND vrij > 0 AND kind <> 'outbound'
      ORDER BY pickable DESC, (kind = 'pick') DESC, vrij DESC, sort_order`,
    [sku]
  );

  const toewijzingen: Toewijzing[] = [];
  let rest = nodig;
  for (const k of kandidaten) {
    if (rest <= 0) break;
    const aantal = Math.min(rest, Number(k.vrij));
    toewijzingen.push({
      location_id: Number(k.location_id),
      sort_order: Number(k.sort_order),
      aantal,
    });
    rest -= aantal;
  }
  return { toewijzingen, tekort: rest };
}

/** Maakt de pickregels voor één sku, gesplitst over locaties waar nodig. */
async function maakRegels(pickOrderId: number, sku: string, aantal: number): Promise<void> {
  const { toewijzingen, tekort } = await kiesLocaties(sku, aantal);

  for (const t of toewijzingen) {
    await query(
      `INSERT INTO wms.pick_lines (pick_order_id, sku, gevraagd, location_id, volgorde)
       VALUES ($1, $2, $3, $4, $5)`,
      [pickOrderId, sku, t.aantal, t.location_id, t.sort_order]
    );
  }

  if (tekort > 0) {
    /* Geen locatie: staat bovenaan de lijst (volgorde 0) zodat een teamleider
       het meteen ziet in plaats van dat de picker er onderaan tegenaan loopt. */
    await query(
      `INSERT INTO wms.pick_lines
         (pick_order_id, sku, gevraagd, location_id, volgorde, note)
       VALUES ($1, $2, $3, NULL, 0, $4)`,
      [pickOrderId, sku, tekort, "Niet op voorraad in het magazijn"]
    );
  }
}

/* ── Importeren ────────────────────────────────────────────────────────────── */

interface PlanRegel {
  sku?: string;
  qty?: number;
}

interface PlanZending {
  store?: string;
  branchId?: string;
  isWarehouse?: boolean;
  lines?: PlanRegel[];
}

interface OrderRij {
  order_number: string;
  fulfillment_plan: { shipments?: PlanZending[] } | null;
}

export interface ImportResultaat {
  nieuw: number;
  overgeslagen: number;
  regels: number;
  zonderVoorraad: number;
}

async function nieuweCode(): Promise<string> {
  const rij = await queryOne<{ n: string }>(
    `SELECT nextval('wms.pick_order_nummer')::text AS n`
  );
  return `P-${String(rij?.n ?? "0").padStart(6, "0")}`;
}

/**
 * Haalt nieuw pickwerk binnen uit de core. Veilig om herhaald te draaien.
 */
export async function importeerPickwerk(door: string | null): Promise<ImportResultaat> {
  const resultaat: ImportResultaat = { nieuw: 0, overgeslagen: 0, regels: 0, zonderVoorraad: 0 };

  /* ── Weborders ────────────────────────────────────────────────────────────
     De core plant per order welke vestiging welke regels levert. Wij pakken
     alleen de zendingen die aan het magazijn zijn toegewezen. */
  const orders = await query<OrderRij>(
    `SELECT order_number, fulfillment_plan
       FROM public.orders
      WHERE fulfillment_status IN ('planned', 'pending')
        AND fulfillment_plan IS NOT NULL
        AND fulfillment_plan->'shipments' IS NOT NULL
      ORDER BY created_at
      LIMIT 500`
  );

  for (const order of orders) {
    const zendingen = order.fulfillment_plan?.shipments ?? [];
    const magazijn = zendingen.filter(
      (z) => z.isWarehouse === true || String(z.branchId) === "99"
    );
    if (magazijn.length === 0) continue;

    const regels = magazijn.flatMap((z) => z.lines ?? []).filter((r) => r.sku && Number(r.qty) > 0);
    if (regels.length === 0) continue;

    const gemaakt = await maakPickOpdracht({
      bron: "weborder",
      bronRef: order.order_number,
      bestemming: "Klant (webshop)",
      prioriteit: 10,
      door,
      regels: regels.map((r) => ({ sku: String(r.sku), aantal: Number(r.qty) })),
    });
    if (gemaakt) {
      resultaat.nieuw += 1;
      resultaat.regels += regels.length;
    } else {
      resultaat.overgeslagen += 1;
    }
  }

  /* ── Transfers vanuit het magazijn naar een winkel ────────────────────────── */
  const zendingen = await query<{
    id: string;
    to_store: string;
    expected_lines: { sku?: string; expectedQty?: number }[] | null;
  }>(
    `SELECT id::text, to_store, expected_lines
       FROM public.inbound_shipments
      WHERE from_location ILIKE '%magazijn%'
        AND status IN ('picked', 'receiving')
      ORDER BY created_at DESC
      LIMIT 200`
  );

  for (const z of zendingen) {
    const regels = (z.expected_lines ?? [])
      .filter((r) => r.sku && Number(r.expectedQty) > 0)
      .map((r) => ({ sku: String(r.sku), aantal: Number(r.expectedQty) }));
    if (regels.length === 0) continue;

    const gemaakt = await maakPickOpdracht({
      bron: "transfer",
      bronRef: z.id,
      bestemming: z.to_store,
      prioriteit: 5,
      door,
      regels,
    });
    if (gemaakt) {
      resultaat.nieuw += 1;
      resultaat.regels += regels.length;
    } else {
      resultaat.overgeslagen += 1;
    }
  }

  const tekorten = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM wms.pick_lines
      WHERE status = 'open' AND location_id IS NULL`
  );
  resultaat.zonderVoorraad = Number(tekorten?.n ?? 0);

  return resultaat;
}

/**
 * Maakt één pickopdracht. Geeft `false` als hij al bestond — dat maakt de
 * import herhaalbaar zonder dubbel werk.
 */
export async function maakPickOpdracht(args: {
  bron: PickBron;
  bronRef: string;
  bestemming?: string | null;
  prioriteit?: number;
  door: string | null;
  note?: string | null;
  regels: { sku: string; aantal: number }[];
}): Promise<PickOpdracht | false> {
  const code = await nieuweCode();

  const opdracht = await queryOne<{ id: number }>(
    `INSERT INTO wms.pick_orders
       (code, bron, bron_ref, bestemming, prioriteit, aangemaakt_door, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (bron, bron_ref) DO NOTHING
     RETURNING id`,
    [
      code,
      args.bron,
      args.bronRef,
      args.bestemming ?? null,
      args.prioriteit ?? 0,
      args.door,
      args.note ?? null,
    ]
  );
  if (!opdracht) return false;

  /* Regels per sku samenvoegen: twee keer dezelfde sku in één order wordt één
     pickregel, anders loopt de picker twee keer naar dezelfde locatie. */
  const perSku = new Map<string, number>();
  for (const r of args.regels) {
    perSku.set(r.sku, (perSku.get(r.sku) ?? 0) + r.aantal);
  }
  for (const [sku, aantal] of perSku) {
    await maakRegels(opdracht.id, sku, aantal);
  }

  return (await pickOpdracht(opdracht.id))!;
}

/* ── Uitvoeren ─────────────────────────────────────────────────────────────── */

export async function startPicken(
  id: number,
  userId: string,
  naam: string
): Promise<PickOpdracht | null> {
  await query(
    `UPDATE wms.pick_orders
        SET status = 'bezig',
            started_at = coalesce(started_at, now()),
            toegewezen_aan = $2, toegewezen_naam = $3
      WHERE id = $1 AND status IN ('open', 'bezig')`,
    [id, userId, naam]
  );
  return pickOpdracht(id);
}

/** De locatie waar gepikte goederen naartoe geboekt worden. */
async function expeditieLocatieId(): Promise<number> {
  const code = String(await instelling<string>("picken.expeditie_locatie")) || "EXPEDITIE";
  const locatie = await zoekLocatie(code);
  if (!locatie) {
    throw new BoekingsFout(
      `Expeditielocatie "${code}" bestaat niet. Maak 'm aan of pas de instelling aan.`,
      "geen_expeditie"
    );
  }
  return locatie.id;
}

export interface PickResultaat {
  regel: PickRegel;
  vervolgRegelId: number | null;
  opdracht: PickOpdracht | null;
}

/**
 * Bevestigt een pickregel. Boekt van de piklocatie naar expeditie — gepikte
 * goederen verdwijnen dus niet uit het grootboek, ze staan op de kade tot ze
 * daadwerkelijk verzonden worden.
 *
 * Is er minder gevonden dan gevraagd, dan boeken we wat er wél was, zetten we de
 * regel op 'kort', en proberen we de rest op een andere locatie toe te wijzen.
 * De picker hoeft dus niet zelf te bedenken waar de rest ligt.
 */
export async function bevestigPickRegel(args: {
  regelId: number;
  aantal: number;
  actorId: string;
  actorNaam: string;
  idempotencyKey?: string | null;
}): Promise<PickResultaat> {
  const regel = await queryOne<PickRegel & { code: string; order_status: string }>(
    `SELECT l.*, loc.code AS location_code, o.code, o.status AS order_status
       FROM wms.pick_lines l
       LEFT JOIN wms.locations loc ON loc.id = l.location_id
       JOIN wms.pick_orders o ON o.id = l.pick_order_id
      WHERE l.id = $1`,
    [args.regelId]
  );
  if (!regel) throw new BoekingsFout("Pickregel bestaat niet.", "onbekend");
  if (regel.status !== "open") {
    throw new BoekingsFout("Deze regel is al afgehandeld.", "al_afgehandeld");
  }
  if (!regel.location_id) {
    throw new BoekingsFout(
      "Deze regel heeft geen locatie — er is geen voorraad toegewezen.",
      "geen_locatie"
    );
  }

  const aantal = Math.floor(args.aantal);
  if (!Number.isInteger(aantal) || aantal < 0 || aantal > regel.gevraagd) {
    throw new BoekingsFout(
      `Aantal moet tussen 0 en ${regel.gevraagd} liggen.`,
      "ongeldig_aantal"
    );
  }

  const expeditie = await expeditieLocatieId();
  let moveId: number | null = null;

  if (aantal > 0) {
    const boeking = await boekMutatie({
      sku: regel.sku,
      vanLocatieId: regel.location_id,
      naarLocatieId: expeditie,
      aantal,
      reden: "pick",
      refType: "pickopdracht",
      refId: regel.code,
      actorId: args.actorId,
      actorNaam: args.actorNaam,
      idempotencyKey: args.idempotencyKey ?? null,
    });
    moveId = boeking.id;
  }

  const status = aantal === regel.gevraagd ? "gepikt" : "kort";
  try {
    await query(
      `UPDATE wms.pick_lines
          SET gepikt = $2, status = $3, move_id = $4, afgerond_at = now()
        WHERE id = $1`,
      [regel.id, aantal, status, moveId]
    );
  } catch (err) {
    throw vertaalDbFout(err);
  }

  /* Tekort: probeer de rest elders. Lukt dat niet, dan blijft het tekort staan
     als regel zonder locatie — zichtbaar, niet stilzwijgend verdwenen. */
  let vervolgRegelId: number | null = null;
  const rest = regel.gevraagd - aantal;
  if (rest > 0) {
    const { toewijzingen } = await kiesLocaties(regel.sku, rest);
    const beste = toewijzingen[0];
    if (beste) {
      const nieuw = await queryOne<{ id: number }>(
        `INSERT INTO wms.pick_lines
           (pick_order_id, sku, gevraagd, location_id, volgorde, note)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          regel.pick_order_id,
          regel.sku,
          beste.aantal,
          beste.location_id,
          beste.sort_order,
          `Restant na tekort op ${regel.location_code}`,
        ]
      );
      vervolgRegelId = nieuw?.id ?? null;
    }
  }

  await werkOpdrachtStatusBij(regel.pick_order_id);

  const bijgewerkt = await queryOne<PickRegel>(
    `SELECT l.*, loc.code AS location_code, loc.zone,
            a.omschrijving, a.merk, a.maat, a.kleur, a.barcode
       FROM wms.pick_lines l
       LEFT JOIN wms.locations loc ON loc.id = l.location_id
       LEFT JOIN wms.artikelen a ON a.sku = l.sku
      WHERE l.id = $1`,
    [regel.id]
  );

  return {
    regel: bijgewerkt!,
    vervolgRegelId,
    opdracht: await pickOpdracht(regel.pick_order_id),
  };
}

export async function slaRegelOver(regelId: number, reden: string): Promise<void> {
  const regel = await queryOne<{ pick_order_id: number }>(
    `UPDATE wms.pick_lines
        SET status = 'overgeslagen', note = $2, afgerond_at = now()
      WHERE id = $1 AND status = 'open'
      RETURNING pick_order_id`,
    [regelId, reden]
  );
  if (regel) await werkOpdrachtStatusBij(regel.pick_order_id);
}

/**
 * Alle regels af → opdracht op 'gepikt'. Geen open regels meer betekent klaar.
 * Bij die overgang gaat er een terugmelding naar de portal: het model dat om
 * deze ronde vroeg wil weten wat er daadwerkelijk gepikt is, niet alleen wat
 * het gevraagd had.
 */
async function werkOpdrachtStatusBij(pickOrderId: number): Promise<void> {
  const afgerond = await queryOne<{ id: number }>(
    `UPDATE wms.pick_orders o
        SET status = 'gepikt', finished_at = now()
      WHERE o.id = $1
        AND o.status = 'bezig'
        AND NOT EXISTS (
          SELECT 1 FROM wms.pick_lines l
           WHERE l.pick_order_id = o.id AND l.status = 'open'
        )
      RETURNING o.id`,
    [pickOrderId]
  );

  if (afgerond) {
    /* Late import: koppeling.ts leest picken.ts, dus statisch zou dit een
       cirkel zijn. De terugmelding mag de boeking bovendien nooit laten falen. */
    try {
      const { meldTerug } = await import("./koppeling");
      await meldTerug({ soort: "gepikt", pickOrderId });
    } catch {
      /* Terugmelden is bijzaak; het grootboek klopt sowieso. */
    }
  }

  /* Zit deze opdracht in een pickronde, dan kan die ronde nu klaar zijn. */
  try {
    const { rondeVanOpdracht, werkRondeStatusBij } = await import("./rondes");
    const rondeId = await rondeVanOpdracht(pickOrderId);
    if (rondeId) await werkRondeStatusBij(rondeId);
  } catch {
    /* Ronde-status is presentatie; de opdracht zelf klopt hoe dan ook. */
  }
}

/**
 * Sluit de opdracht af: de gepikte goederen gaan van expeditie het pand uit.
 * Dit is de tweede boeking — pas hier verlaat de voorraad het magazijn.
 */
export async function verzendPickOpdracht(args: {
  id: number;
  actorId: string;
  actorNaam: string;
}): Promise<PickOpdracht | null> {
  const opdracht = await pickOpdracht(args.id);
  if (!opdracht) throw new BoekingsFout("Pickopdracht bestaat niet.", "onbekend");
  if (opdracht.status === "afgesloten") return opdracht;
  if (opdracht.open_regels > 0) {
    throw new BoekingsFout(
      "Er staan nog open regels. Rond die eerst af of sla ze over.",
      "nog_open"
    );
  }

  const expeditie = await expeditieLocatieId();
  const gepikt = await query<{ sku: string; aantal: number }>(
    `SELECT sku, sum(gepikt)::int AS aantal
       FROM wms.pick_lines
      WHERE pick_order_id = $1 AND gepikt > 0
      GROUP BY sku`,
    [args.id]
  );

  for (const regel of gepikt) {
    await boekMutatie({
      sku: regel.sku,
      vanLocatieId: expeditie,
      naarLocatieId: null,
      aantal: Number(regel.aantal),
      reden: "verzonden",
      refType: "pickopdracht",
      refId: opdracht.code,
      actorId: args.actorId,
      actorNaam: args.actorNaam,
      /* Eén sleutel per (opdracht, sku): een dubbele klik op "verzenden" boekt
         daardoor niet twee keer de deur uit. */
      idempotencyKey: `verzend:${opdracht.code}:${regel.sku}`,
    });
  }

  await query(
    `UPDATE wms.pick_orders
        SET status = 'afgesloten', finished_at = coalesce(finished_at, now())
      WHERE id = $1`,
    [args.id]
  );

  try {
    const { meldTerug } = await import("./koppeling");
    await meldTerug({ soort: "verzonden", pickOrderId: args.id });
  } catch {
    /* Zie werkOpdrachtStatusBij: terugmelden mag de boeking niet blokkeren. */
  }

  return pickOpdracht(args.id);
}
