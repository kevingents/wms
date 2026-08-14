import { query, queryOne, BoekingsFout } from "./db";
import { boekMutatie, zoekLocatie } from "./voorraad";
import { instelling } from "./instellingen";

/**
 * Inpakken en verzenden — het sluitstuk van de uitgaande stroom.
 *
 * Zonder dit is een volle bak een doodlopend eind: gepikte goederen staan op
 * EXPEDITIE en er is geen moment waarop het systeem zegt "deze doos is dicht en
 * gaat naar dit adres". Dan gebeurt dat buiten het systeem om, en precies daar
 * ontstaat het verschil dat je later niet meer kunt verklaren.
 *
 * EEN ZENDING IS ÉÉN DOOS
 * -----------------------
 * Niet één order. Eén pickopdracht kan twee dozen opleveren omdat het niet past
 * of te zwaar wordt, en dan hoort de tweede doos ook een eigen tracking te
 * krijgen. Een model waarin order en doos hetzelfde zijn, dwingt de inpakker om
 * te liegen zodra de werkelijkheid niet meewerkt.
 *
 * CONTROLEREN HOORT BIJ INPAKKEN
 * ------------------------------
 * De inpakker scant wat er in de doos gaat. Dat is de laatste kans om een
 * mispick te vangen vóór hij bij de klant ligt, en het kost twee seconden per
 * artikel. Wie die stap overslaat, betaalt hem terug in retouren.
 */

export interface Zending {
  id: number;
  code: string;
  pick_order_id: number | null;
  opdracht_code: string | null;
  bestemming: string | null;
  status: "open" | "ingepakt" | "verzonden" | "geannuleerd";
  doos_type: string | null;
  gewicht_gram: number | null;
  vervoerder: string | null;
  tracking: string | null;
  ingepakt_naam: string | null;
  ingepakt_at: string | null;
  verzonden_at: string | null;
  note: string | null;
  created_at: string;
  regels: number;
  stuks: number;
  gecontroleerd: number;
}

export interface ZendingRegel {
  id: number;
  zending_id: number;
  sku: string;
  aantal: number;
  gecontroleerd: boolean;
  omschrijving: string | null;
  merk: string | null;
  maat: string | null;
  kleur: string | null;
  barcode: string | null;
}

export interface DoosType {
  code: string;
  naam: string;
  lengte_mm: number | null;
  breedte_mm: number | null;
  hoogte_mm: number | null;
  max_gewicht_g: number | null;
  tarra_gram: number;
}

const ZENDING_SELECT = `
  SELECT z.*, po.code AS opdracht_code,
         (SELECT count(*) FROM wms.zending_regels r WHERE r.zending_id = z.id)::int AS regels,
         (SELECT coalesce(sum(r.aantal), 0) FROM wms.zending_regels r
           WHERE r.zending_id = z.id)::int                                          AS stuks,
         (SELECT count(*) FROM wms.zending_regels r
           WHERE r.zending_id = z.id AND r.gecontroleerd)::int                       AS gecontroleerd
    FROM wms.zendingen z
    LEFT JOIN wms.pick_orders po ON po.id = z.pick_order_id`;

export async function openZendingen(): Promise<Zending[]> {
  return query<Zending>(
    `${ZENDING_SELECT} WHERE z.status IN ('open', 'ingepakt') ORDER BY z.created_at`
  );
}

export async function zending(id: number): Promise<Zending | null> {
  return queryOne<Zending>(`${ZENDING_SELECT} WHERE z.id = $1`, [id]);
}

export async function zendingRegels(id: number): Promise<ZendingRegel[]> {
  return query<ZendingRegel>(
    `SELECT r.*, a.omschrijving, a.merk, a.maat, a.kleur, a.barcode
       FROM wms.zending_regels r
       LEFT JOIN wms.artikelen a ON a.sku = r.sku
      WHERE r.zending_id = $1
      ORDER BY r.gecontroleerd, r.sku`,
    [id]
  );
}

export async function doosTypes(): Promise<DoosType[]> {
  return query<DoosType>(
    `SELECT * FROM wms.doos_types WHERE actief ORDER BY sort_order, code`
  );
}

async function nieuweCode(): Promise<string> {
  const rij = await queryOne<{ n: string }>(
    `SELECT nextval('wms.zending_nummer')::text AS n`
  );
  return `Z-${String(rij?.n ?? "0").padStart(6, "0")}`;
}

/**
 * Maakt een inpakopdracht van wat er voor deze pickopdracht gepikt is.
 *
 * Alleen wat écht gepikt is komt in de doos — niet wat gevraagd was. Een order
 * waarvan de helft niet gevonden werd, levert een doos met de helft; dat is de
 * waarheid en de klant hoort dat te horen van de portal, niet te ontdekken bij
 * het uitpakken.
 */
export async function maakZendingVoorOpdracht(args: {
  pickOrderId: number;
  door: string | null;
}): Promise<Zending> {
  const opdracht = await queryOne<{
    id: number;
    code: string;
    bestemming: string | null;
    status: string;
  }>(`SELECT id, code, bestemming, status FROM wms.pick_orders WHERE id = $1`, [
    args.pickOrderId,
  ]);
  if (!opdracht) throw new BoekingsFout("Pickopdracht bestaat niet.", "onbekend");
  if (opdracht.status === "open") {
    throw new BoekingsFout(
      "Deze opdracht is nog niet gepikt — er is niets om in te pakken.",
      "niet_gepikt"
    );
  }

  const bestaand = await queryOne<{ id: number }>(
    `SELECT id FROM wms.zendingen
      WHERE pick_order_id = $1 AND status IN ('open', 'ingepakt')
      ORDER BY id LIMIT 1`,
    [args.pickOrderId]
  );
  if (bestaand) return (await zending(bestaand.id))!;

  const gepikt = await query<{ sku: string; aantal: number }>(
    `SELECT sku, sum(gepikt)::int AS aantal
       FROM wms.pick_lines
      WHERE pick_order_id = $1 AND gepikt > 0
      GROUP BY sku`,
    [args.pickOrderId]
  );
  if (gepikt.length === 0) {
    throw new BoekingsFout(
      "Er is niets gepikt voor deze opdracht — een lege doos versturen heeft geen zin.",
      "niets_gepikt"
    );
  }

  const code = await nieuweCode();
  const nieuw = await queryOne<{ id: number }>(
    `INSERT INTO wms.zendingen (code, pick_order_id, bestemming, note)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [code, opdracht.id, opdracht.bestemming, `Uit pickopdracht ${opdracht.code}`]
  );

  for (const r of gepikt) {
    await query(
      `INSERT INTO wms.zending_regels (zending_id, sku, aantal) VALUES ($1, $2, $3)`,
      [nieuw!.id, r.sku, Number(r.aantal)]
    );
  }

  return (await zending(nieuw!.id))!;
}

/** Vinkt één regel af bij het inpakken — de scan-controle aan de paktafel. */
export async function controleerRegel(args: {
  zendingId: number;
  code: string;
}): Promise<{ regel: ZendingRegel | null; message?: string }> {
  const schoon = args.code.trim();
  const regel = await queryOne<{ id: number; gecontroleerd: boolean }>(
    `SELECT r.id, r.gecontroleerd
       FROM wms.zending_regels r
       LEFT JOIN wms.artikelen a ON a.sku = r.sku
      WHERE r.zending_id = $1
        AND (upper(r.sku) = upper($2) OR a.barcode = $2)
      LIMIT 1`,
    [args.zendingId, schoon]
  );

  if (!regel) {
    return {
      regel: null,
      message: `${schoon} hoort niet bij deze zending. Leg apart en controleer de pickronde.`,
    };
  }
  if (regel.gecontroleerd) {
    return { regel: null, message: "Dit artikel is al afgevinkt." };
  }

  await query(`UPDATE wms.zending_regels SET gecontroleerd = true WHERE id = $1`, [
    regel.id,
  ]);

  const regels = await zendingRegels(args.zendingId);
  return { regel: regels.find((r) => r.id === regel.id) ?? null };
}

/**
 * Sluit de doos: legt doostype, gewicht en vervoerder vast.
 *
 * Nog geen boeking — de goederen staan op EXPEDITIE en dat klopt: de doos staat
 * fysiek nog in het pand. Pas bij verzenden verlaten ze de voorraad.
 */
export async function pakIn(args: {
  zendingId: number;
  doosType?: string | null;
  gewichtGram?: number | null;
  vervoerder?: string | null;
  actorId: string;
  actorNaam: string;
  forceerZonderControle?: boolean;
}): Promise<Zending> {
  const huidige = await zending(args.zendingId);
  if (!huidige) throw new BoekingsFout("Zending bestaat niet.", "onbekend");
  if (huidige.status !== "open") {
    throw new BoekingsFout("Deze zending is al ingepakt.", "al_ingepakt");
  }

  const controleVerplicht = Boolean(
    await instelling<boolean>("inpakken.controle_verplicht")
  );
  if (
    controleVerplicht &&
    !args.forceerZonderControle &&
    huidige.gecontroleerd < huidige.regels
  ) {
    throw new BoekingsFout(
      `Nog ${huidige.regels - huidige.gecontroleerd} artikel(en) niet gescand. Scan alles, of laat een teamleider het overslaan.`,
      "niet_gecontroleerd"
    );
  }

  await query(
    `UPDATE wms.zendingen
        SET status = 'ingepakt', doos_type = $2, gewicht_gram = $3, vervoerder = $4,
            ingepakt_door = $5, ingepakt_naam = $6, ingepakt_at = now()
      WHERE id = $1`,
    [
      args.zendingId,
      args.doosType ?? null,
      args.gewichtGram ?? null,
      args.vervoerder ?? (await instelling<string>("inpakken.standaard_vervoerder")),
      args.actorId,
      args.actorNaam,
    ]
  );

  return (await zending(args.zendingId))!;
}

/**
 * Verzendt de doos: boekt de inhoud van EXPEDITIE het pand uit.
 *
 * Dit is de tweede en laatste boeking van de uitgaande stroom. Idempotent per
 * (zending, sku), zodat een dubbele klik op verzenden niet twee keer afboekt.
 */
export async function verzend(args: {
  zendingId: number;
  tracking?: string | null;
  actorId: string;
  actorNaam: string;
}): Promise<Zending> {
  const huidige = await zending(args.zendingId);
  if (!huidige) throw new BoekingsFout("Zending bestaat niet.", "onbekend");
  if (huidige.status === "verzonden") return huidige;
  if (huidige.status !== "ingepakt") {
    throw new BoekingsFout("Pak de zending eerst in.", "niet_ingepakt");
  }

  const code = String(await instelling<string>("picken.expeditie_locatie")) || "EXPEDITIE";
  const expeditie = await zoekLocatie(code);
  if (!expeditie) {
    throw new BoekingsFout(`Expeditielocatie "${code}" bestaat niet.`, "geen_expeditie");
  }

  const regels = await zendingRegels(args.zendingId);
  for (const r of regels) {
    await boekMutatie({
      sku: r.sku,
      vanLocatieId: expeditie.id,
      naarLocatieId: null,
      aantal: r.aantal,
      reden: "verzonden",
      refType: "zending",
      refId: huidige.code,
      actorId: args.actorId,
      actorNaam: args.actorNaam,
      idempotencyKey: `zending:${huidige.code}:${r.sku}`,
    });
  }

  await query(
    `UPDATE wms.zendingen
        SET status = 'verzonden', verzonden_at = now(), tracking = coalesce($2, tracking)
      WHERE id = $1`,
    [args.zendingId, args.tracking ?? null]
  );

  /* De pickopdracht is hiermee ook echt de deur uit. */
  if (huidige.pick_order_id) {
    await query(
      `UPDATE wms.pick_orders
          SET status = 'afgesloten', finished_at = coalesce(finished_at, now())
        WHERE id = $1 AND status = 'gepikt'`,
      [huidige.pick_order_id]
    );
    try {
      const { meldTerug } = await import("./koppeling");
      await meldTerug({ soort: "verzonden", pickOrderId: huidige.pick_order_id });
    } catch {
      /* Terugmelden is bijzaak; de doos is de deur uit en dat staat vast. */
    }
  }

  return (await zending(args.zendingId))!;
}
