import { query, queryOne, BoekingsFout } from "./db";
import { boekMutatie } from "./voorraad";

/**
 * Taken — de werkwachtrij van het magazijn.
 *
 * Wat een WMS onderscheidt van een voorraadlijst is dat het wérk uitdeelt. Een
 * taak is één opdracht aan één persoon: haal dit daar weg en zet het daar neer,
 * of tel dit vak. Replenishment, cyclustellingen en opruimwerk hebben allemaal
 * dezelfde vorm, dus één wachtrij volstaat — drie half-af wachtrijen is wat er
 * gebeurt als je ze apart bouwt.
 *
 * REPLENISHMENT
 * -------------
 * Een piklocatie met een vast artikel en een min/max vult zichzelf aan: zakt de
 * voorraad onder het minimum, dan ontstaat er werk om bij te vullen tot het
 * maximum. Vóórdat de picker voor een leeg vak staat, niet erna — dat is het
 * hele verschil tussen replenishment en brandjes blussen.
 *
 * De unieke index in het schema zorgt dat er maar één open taak per (sku, vak)
 * bestaat. Zonder dat maakt de generator er elke minuut een nieuwe en staat de
 * medewerker straks voor een lege stelling met twintig identieke taken.
 */

export type TaakSoort =
  | "replenishment"
  | "telling"
  | "opruimen"
  | "controle"
  | "verplaatsing";

export interface Taak {
  id: number;
  soort: TaakSoort;
  sku: string | null;
  van_locatie_id: number | null;
  van_code: string | null;
  naar_locatie_id: number | null;
  naar_code: string | null;
  aantal: number | null;
  prioriteit: number;
  status: "open" | "bezig" | "klaar" | "geannuleerd";
  reden: string | null;
  toegewezen_naam: string | null;
  created_at: string;
  omschrijving: string | null;
  maat: string | null;
  barcode: string | null;
  volgorde: number;
}

const TAAK_SELECT = `
  SELECT t.*,
         vl.code AS van_code, nl.code AS naar_code,
         coalesce(vl.sort_order, nl.sort_order, 0) AS volgorde,
         a.omschrijving, a.maat, a.barcode
    FROM wms.taken t
    LEFT JOIN wms.locations vl ON vl.id = t.van_locatie_id
    LEFT JOIN wms.locations nl ON nl.id = t.naar_locatie_id
    LEFT JOIN wms.artikelen a ON a.sku = t.sku`;

export async function openTaken(soort?: TaakSoort): Promise<Taak[]> {
  return query<Taak>(
    `${TAAK_SELECT}
      WHERE t.status IN ('open', 'bezig')
        ${soort ? "AND t.soort = $1" : ""}
      ORDER BY t.prioriteit DESC, coalesce(vl.sort_order, nl.sort_order, 0), t.created_at`,
    soort ? [soort] : []
  );
}

export async function taak(id: number): Promise<Taak | null> {
  return queryOne<Taak>(`${TAAK_SELECT} WHERE t.id = $1`, [id]);
}

export async function maakTaak(args: {
  soort: TaakSoort;
  sku?: string | null;
  vanLocatieId?: number | null;
  naarLocatieId?: number | null;
  aantal?: number | null;
  prioriteit?: number;
  reden?: string | null;
  refType?: string | null;
  refId?: string | null;
  door: string | null;
}): Promise<Taak | null> {
  const rij = await queryOne<{ id: number }>(
    `INSERT INTO wms.taken
       (soort, sku, van_locatie_id, naar_locatie_id, aantal, prioriteit,
        reden, ref_type, ref_id, aangemaakt_door)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      args.soort,
      args.sku ?? null,
      args.vanLocatieId ?? null,
      args.naarLocatieId ?? null,
      args.aantal ?? null,
      args.prioriteit ?? 0,
      args.reden ?? null,
      args.refType ?? null,
      args.refId ?? null,
      args.door,
    ]
  );
  return rij ? taak(rij.id) : null;
}

/* ── Replenishment ─────────────────────────────────────────────────────────── */

export interface ReplenAdvies {
  pick_locatie_id: number;
  pick_locatie: string;
  sku: string;
  min_voorraad: number;
  max_voorraad: number;
  aanwezig: number;
  tekort: number;
  bulk_vrij: number;
  aan_te_vullen: number;
  omschrijving?: string | null;
}

export async function replenAdvies(): Promise<ReplenAdvies[]> {
  return query<ReplenAdvies>(
    `SELECT r.*, a.omschrijving
       FROM wms.replen_advies r
       LEFT JOIN wms.artikelen a ON a.sku = r.sku
      WHERE r.aan_te_vullen > 0
      ORDER BY (r.aanwezig::numeric / nullif(r.min_voorraad, 0)) NULLS FIRST,
               r.aan_te_vullen DESC`
  );
}

/**
 * Zet het advies om in taken. Draait als cron én handmatig.
 *
 * De bronlocatie kiezen we hier bewust nog niet: dat kan tussen het maken en het
 * uitvoeren van de taak veranderen. De medewerker krijgt bij het oppakken te
 * horen waar het ligt — dan klopt het ook echt.
 */
export async function genereerReplenTaken(
  door: string | null
): Promise<{ gemaakt: number; overgeslagen: number }> {
  const advies = await replenAdvies();
  let gemaakt = 0;
  let overgeslagen = 0;

  for (const a of advies) {
    const taak = await maakTaak({
      soort: "replenishment",
      sku: a.sku,
      naarLocatieId: a.pick_locatie_id,
      aantal: a.aan_te_vullen,
      /* Hoe leger het vak, hoe hoger de prioriteit. Een leeg pikvak kost een
         mispick; een half vol vak kost niets. */
      prioriteit: a.aanwezig === 0 ? 20 : 10,
      reden: `Onder minimum (${a.aanwezig}/${a.min_voorraad}) — aanvullen tot ${a.max_voorraad}`,
      refType: "replen",
      refId: `${a.pick_locatie}:${a.sku}`,
      door,
    });
    if (taak) gemaakt += 1;
    else overgeslagen += 1;
  }

  return { gemaakt, overgeslagen };
}

/**
 * Waar kan dit artikel vandaan gehaald worden? Voor het uitvoerscherm: de
 * medewerker krijgt de vakken met de meeste vrije voorraad eerst, zodat hij in
 * één keer genoeg heeft.
 */
export async function bronnenVoor(
  sku: string,
  behalveLocatieId?: number | null
): Promise<{ location_id: number; code: string; vrij: number; sort_order: number }[]> {
  return query(
    `SELECT location_id, location_code AS code, vrij, sort_order
       FROM wms.vrije_voorraad
      WHERE sku = $1
        AND vrij > 0
        AND kind NOT IN ('outbound', 'quarantine')
        ${behalveLocatieId ? "AND location_id <> $2" : ""}
      ORDER BY vrij DESC, sort_order
      LIMIT 10`,
    behalveLocatieId ? [sku, behalveLocatieId] : [sku]
  );
}

export async function startTaak(
  id: number,
  userId: string,
  naam: string
): Promise<Taak | null> {
  await query(
    `UPDATE wms.taken
        SET status = 'bezig', started_at = coalesce(started_at, now()),
            toegewezen_aan = $2, toegewezen_naam = $3
      WHERE id = $1 AND status IN ('open', 'bezig')`,
    [id, userId, naam]
  );
  return taak(id);
}

/**
 * Rondt een verplaatsingstaak af met een echte boeking. De medewerker geeft aan
 * waar hij het vandaan haalde en hoeveel hij daadwerkelijk verplaatste — minder
 * dan gevraagd is een geldige uitkomst, want de bulk kan ook leeg zijn.
 */
export async function rondTaakAf(args: {
  taakId: number;
  vanLocatieId: number;
  aantal: number;
  actorId: string;
  actorNaam: string;
  idempotencyKey?: string | null;
}): Promise<Taak> {
  const t = await taak(args.taakId);
  if (!t) throw new BoekingsFout("Taak bestaat niet.", "onbekend");
  if (t.status === "klaar") throw new BoekingsFout("Taak is al afgerond.", "al_klaar");
  if (!t.sku || !t.naar_locatie_id) {
    throw new BoekingsFout(
      "Deze taak heeft geen artikel of doellocatie en kan niet als verplaatsing worden afgerond.",
      "onvolledig"
    );
  }

  const aantal = Math.floor(args.aantal);
  if (!Number.isInteger(aantal) || aantal <= 0) {
    throw new BoekingsFout("Aantal moet groter dan 0 zijn.", "ongeldig_aantal");
  }

  const boeking = await boekMutatie({
    sku: t.sku,
    vanLocatieId: args.vanLocatieId,
    naarLocatieId: t.naar_locatie_id,
    aantal,
    reden: "verplaatsing",
    refType: "taak",
    refId: String(t.id),
    notitie: t.reden,
    actorId: args.actorId,
    actorNaam: args.actorNaam,
    idempotencyKey: args.idempotencyKey ?? null,
  });

  await query(
    `UPDATE wms.taken
        SET status = 'klaar', finished_at = now(), move_id = $2
      WHERE id = $1`,
    [t.id, boeking.id]
  );

  return (await taak(t.id))!;
}

export async function annuleerTaak(id: number, reden: string): Promise<void> {
  await query(
    `UPDATE wms.taken
        SET status = 'geannuleerd', finished_at = now(),
            reden = coalesce(reden, '') || ' — geannuleerd: ' || $2
      WHERE id = $1 AND status IN ('open', 'bezig')`,
    [id, reden]
  );
}

/* ── Cyclustellingen ───────────────────────────────────────────────────────── */

export interface TelKandidaat {
  location_id: number;
  locatie: string;
  zone: string | null;
  stuks: number;
  skus: number;
  mutaties_90d: number;
  laatst_geteld: string | null;
  dagen_geleden: number;
  score: number;
}

/**
 * Welke vakken zijn aan de beurt? Ouderdom weegt lineair, beweging als
 * vermenigvuldiger — een druk vak dat een maand niet geteld is scoort hoger dan
 * een stil vak van een jaar. Alles even vaak tellen is verspilling.
 */
export async function telKandidaten(limiet = 25): Promise<TelKandidaat[]> {
  return query<TelKandidaat>(
    `SELECT * FROM wms.tel_kandidaten
      WHERE stuks > 0
      ORDER BY score DESC
      LIMIT $1`,
    [limiet]
  );
}

/** Zet de bovenste kandidaten om in telopdrachten voor vandaag. */
export async function planTellingen(
  aantal: number,
  door: string | null
): Promise<{ gemaakt: number }> {
  const kandidaten = await telKandidaten(aantal);
  let gemaakt = 0;

  for (const k of kandidaten) {
    const bestaat = await queryOne<{ id: number }>(
      `SELECT id FROM wms.taken
        WHERE soort = 'telling' AND van_locatie_id = $1 AND status IN ('open', 'bezig')`,
      [k.location_id]
    );
    if (bestaat) continue;

    const t = await maakTaak({
      soort: "telling",
      vanLocatieId: k.location_id,
      prioriteit: Math.min(Math.floor(k.score / 100), 30),
      reden:
        k.laatst_geteld === null
          ? "Nog nooit geteld"
          : `${k.dagen_geleden} dagen geleden geteld, ${k.mutaties_90d} mutaties sindsdien`,
      refType: "cyclustelling",
      refId: k.locatie,
      door,
    });
    if (t) gemaakt += 1;
  }

  return { gemaakt };
}
