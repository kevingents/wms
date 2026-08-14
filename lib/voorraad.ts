import { query, queryOne, vertaalDbFout, BoekingsFout } from "./db";
import type {
  Artikel,
  BoekingRegel,
  BoekingReden,
  Locatie,
  SaldoRegel,
  ShadowRegel,
} from "./types";

/**
 * Voorraad-domein. Alle schrijfacties lopen hier langs; nergens anders in de
 * codebase staat een INSERT op wms.stock_moves.
 *
 * De regel die alles draagt: saldi worden nooit direct geschreven. Je boekt een
 * mutatie, de databasetrigger rekent de saldi bij. Daarmee is "de voorraad klopt
 * niet" altijd beantwoordbaar — er is een spoor.
 *
 * Sleutel is `sku` (text), gelijk aan public.srs_stock en public.stock_levels.
 * Scannen gebeurt op barcode; die wordt hier naar sku vertaald.
 */

/* ── Artikelen opzoeken ────────────────────────────────────────────────────── */

/** Scan-resolutie: barcode eerst (dat is wat de scanner leest), dan SKU. */
export async function zoekArtikel(code: string): Promise<Artikel | null> {
  const schoon = code.trim();
  if (!schoon) return null;

  const viaBarcode = await queryOne<Artikel>(
    `SELECT a.* FROM wms.artikelen a
       JOIN wms.barcodes b ON b.sku = a.sku
      WHERE b.barcode = $1
      LIMIT 1`,
    [schoon]
  );
  if (viaBarcode) return viaBarcode;

  return queryOne<Artikel>(
    `SELECT * FROM wms.artikelen WHERE upper(sku) = upper($1) LIMIT 1`,
    [schoon]
  );
}

/** Vrij zoeken voor de UI — SKU, barcode, omschrijving, merk. */
export async function zoekArtikelen(term: string, limiet = 25): Promise<Artikel[]> {
  const schoon = term.trim();
  if (!schoon) return [];
  return query<Artikel>(
    `SELECT a.* FROM wms.artikelen a
      WHERE a.barcode = $1
         OR upper(a.sku) LIKE upper($2)
         OR upper(coalesce(a.omschrijving, '')) LIKE upper($2)
         OR upper(coalesce(a.merk, '')) LIKE upper($2)
      ORDER BY (a.barcode = $1) DESC, a.sku
      LIMIT $3`,
    [schoon, `%${schoon}%`, limiet]
  );
}

/* ── Locaties ──────────────────────────────────────────────────────────────── */

export async function zoekLocatie(code: string): Promise<Locatie | null> {
  const schoon = code.trim();
  if (!schoon) return null;
  return queryOne<Locatie>(
    `SELECT * FROM wms.locations WHERE upper(code) = upper($1) AND active LIMIT 1`,
    [schoon]
  );
}

export async function alleLocaties(alleenActief = true): Promise<Locatie[]> {
  return query<Locatie>(
    `SELECT * FROM wms.locations ${alleenActief ? "WHERE active" : ""}
      ORDER BY sort_order, code`
  );
}

export async function maakLocatie(l: {
  code: string;
  name?: string | null;
  zone?: string | null;
  kind?: string;
  sortOrder?: number;
  pickable?: boolean;
  note?: string | null;
}): Promise<Locatie> {
  const rij = await queryOne<Locatie>(
    `INSERT INTO wms.locations (code, name, zone, kind, sort_order, pickable, note)
     VALUES (upper($1), $2, $3, $4, $5, $6, $7)
     ON CONFLICT (code) DO UPDATE SET
       name = excluded.name, zone = excluded.zone, kind = excluded.kind,
       sort_order = excluded.sort_order, pickable = excluded.pickable,
       note = excluded.note, active = true, updated_at = now()
     RETURNING *`,
    [
      l.code.trim(),
      l.name ?? null,
      l.zone ?? null,
      l.kind ?? "pick",
      l.sortOrder ?? 0,
      l.pickable ?? true,
      l.note ?? null,
    ]
  );
  if (!rij) throw new BoekingsFout("Locatie niet opgeslagen.");
  return rij;
}

/**
 * Locaties gaan nooit weg, ze worden inactief. Ze staan in het grootboek en dat
 * is append-only — verwijderen zou de historie onleesbaar maken.
 */
export async function deactiveerLocatie(id: number): Promise<void> {
  const saldo = await queryOne<{ n: string }>(
    `SELECT coalesce(sum(qty), 0)::text AS n FROM wms.stock_levels WHERE location_id = $1`,
    [id]
  );
  if (Number(saldo?.n ?? 0) > 0) {
    throw new BoekingsFout(
      "Er ligt nog voorraad op deze locatie. Boek die eerst weg.",
      "locatie_niet_leeg"
    );
  }
  await query(`UPDATE wms.locations SET active = false, updated_at = now() WHERE id = $1`, [id]);
}

/* ── Saldi lezen ───────────────────────────────────────────────────────────── */

/** Waar ligt dit artikel, en hoeveel? */
export async function saldiVanArtikel(sku: string): Promise<SaldoRegel[]> {
  return query<SaldoRegel>(
    `SELECT s.sku, s.location_id, s.qty, s.updated_at,
            l.code AS location_code, l.zone,
            a.omschrijving, a.maat, a.kleur
       FROM wms.stock_levels s
       JOIN wms.locations l ON l.id = s.location_id
       LEFT JOIN wms.artikelen a ON a.sku = s.sku
      WHERE s.sku = $1 AND s.qty > 0
      ORDER BY l.sort_order, l.code`,
    [sku]
  );
}

/** Wat ligt er op deze locatie? */
export async function saldiVanLocatie(locationId: number): Promise<SaldoRegel[]> {
  return query<SaldoRegel>(
    `SELECT s.sku, s.location_id, s.qty, s.updated_at,
            l.code AS location_code, l.zone,
            a.omschrijving, a.maat, a.kleur
       FROM wms.stock_levels s
       JOIN wms.locations l ON l.id = s.location_id
       LEFT JOIN wms.artikelen a ON a.sku = s.sku
      WHERE s.location_id = $1 AND s.qty > 0
      ORDER BY s.sku`,
    [locationId]
  );
}

/** Totaal over alle magazijnlocaties — dit getal gaat tegen SRS branch 99 aan. */
export async function totaalVanArtikel(sku: string): Promise<number> {
  const rij = await queryOne<{ totaal: string }>(
    `SELECT coalesce(sum(qty), 0)::text AS totaal FROM wms.stock_levels WHERE sku = $1`,
    [sku]
  );
  return Number(rij?.totaal ?? 0);
}

export async function recenteBoekingen(limiet = 50): Promise<BoekingRegel[]> {
  return query<BoekingRegel>(
    `SELECT m.*, vl.code AS van_code, nl.code AS naar_code, a.omschrijving
       FROM wms.stock_moves m
       LEFT JOIN wms.locations vl ON vl.id = m.from_location_id
       LEFT JOIN wms.locations nl ON nl.id = m.to_location_id
       LEFT JOIN wms.artikelen a ON a.sku = m.sku
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $1`,
    [limiet]
  );
}

/* ── Boeken ────────────────────────────────────────────────────────────────── */

export interface BoekOpdracht {
  sku: string;
  vanLocatieId?: number | null;
  naarLocatieId?: number | null;
  aantal: number;
  reden: BoekingReden;
  refType?: string | null;
  refId?: string | null;
  actorId?: string | null;
  actorNaam?: string | null;
  notitie?: string | null;
  /**
   * Maakt herhaald versturen veilig. De scan-app genereert deze sleutel vóór
   * verzending en hergebruikt 'm bij een retry uit de offline-outbox — zonder
   * dit boek je bij slechte magazijn-wifi dubbel.
   */
  idempotencyKey?: string | null;
}

/**
 * Boekt één mutatie. De trigger op stock_moves werkt de saldi bij in dezelfde
 * transactie, dus dit is atomair ondanks de HTTP-driver.
 *
 * Bij een herhaalde `idempotencyKey` geven we de bestaande boeking terug in
 * plaats van een fout — voor de scan-app is een retry dan gewoon "gelukt".
 */
export async function boekMutatie(opdracht: BoekOpdracht): Promise<BoekingRegel> {
  const {
    sku,
    vanLocatieId = null,
    naarLocatieId = null,
    aantal,
    reden,
    refType = null,
    refId = null,
    actorId = null,
    actorNaam = null,
    notitie = null,
    idempotencyKey = null,
  } = opdracht;

  if (!sku?.trim()) {
    throw new BoekingsFout("Geen artikel opgegeven.", "geen_artikel");
  }
  if (!Number.isInteger(aantal) || aantal <= 0) {
    throw new BoekingsFout("Aantal moet een positief geheel getal zijn.", "ongeldig_aantal");
  }
  if (!vanLocatieId && !naarLocatieId) {
    throw new BoekingsFout("Geef minstens een van- of naar-locatie op.", "geen_locatie");
  }

  if (idempotencyKey) {
    const bestaand = await bestaandeBoeking(idempotencyKey);
    if (bestaand) return bestaand;
  }

  try {
    const rij = await queryOne<{ id: number }>(
      `INSERT INTO wms.stock_moves
         (sku, from_location_id, to_location_id, qty, reason,
          ref_type, ref_id, actor_id, actor_name, note, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        sku.trim(),
        vanLocatieId,
        naarLocatieId,
        aantal,
        reden,
        refType,
        refId,
        actorId,
        actorNaam,
        notitie,
        idempotencyKey,
      ]
    );
    if (!rij) throw new BoekingsFout("Boeking niet opgeslagen.");
    const volledig = await boekingOpId(rij.id);
    if (!volledig) throw new BoekingsFout("Boeking niet teruggelezen.");
    return volledig;
  } catch (err) {
    if (err instanceof BoekingsFout) throw err;
    /* Race op de idempotency-sleutel: twee retries tegelijk. De winnaar staat er
       inmiddels, dus die geven we terug. */
    if ((err as { code?: string })?.code === "23505" && idempotencyKey) {
      const bestaand = await bestaandeBoeking(idempotencyKey);
      if (bestaand) return bestaand;
    }
    throw vertaalDbFout(err);
  }
}

async function bestaandeBoeking(sleutel: string): Promise<BoekingRegel | null> {
  return queryOne<BoekingRegel>(
    `SELECT m.*, vl.code AS van_code, nl.code AS naar_code, a.omschrijving
       FROM wms.stock_moves m
       LEFT JOIN wms.locations vl ON vl.id = m.from_location_id
       LEFT JOIN wms.locations nl ON nl.id = m.to_location_id
       LEFT JOIN wms.artikelen a ON a.sku = m.sku
      WHERE m.idempotency_key = $1`,
    [sleutel]
  );
}

async function boekingOpId(id: number): Promise<BoekingRegel | null> {
  return queryOne<BoekingRegel>(
    `SELECT m.*, vl.code AS van_code, nl.code AS naar_code, a.omschrijving
       FROM wms.stock_moves m
       LEFT JOIN wms.locations vl ON vl.id = m.from_location_id
       LEFT JOIN wms.locations nl ON nl.id = m.to_location_id
       LEFT JOIN wms.artikelen a ON a.sku = m.sku
      WHERE m.id = $1`,
    [id]
  );
}

/**
 * Boekt een telling: zet het saldo op een locatie naar het gételde aantal.
 *
 * Lezen-en-dan-schrijven in één statement, met FOR UPDATE op de saldorij, zodat
 * een gelijktijdige pick de telling niet stiekem achterhaalt. Geeft `null` terug
 * als er niets te corrigeren viel (geteld == verwacht) — dat is geen fout.
 */
export async function boekTelling(args: {
  sku: string;
  locatieId: number;
  geteld: number;
  actorId?: string | null;
  actorNaam?: string | null;
  notitie?: string | null;
  idempotencyKey?: string | null;
}): Promise<{ boekingId: number | null; verwacht: number; verschil: number }> {
  const { sku, locatieId, geteld } = args;
  if (!Number.isInteger(geteld) || geteld < 0) {
    throw new BoekingsFout("Geteld aantal moet 0 of hoger zijn.", "ongeldig_aantal");
  }

  const huidig = await queryOne<{ qty: number }>(
    `SELECT qty FROM wms.stock_levels WHERE sku = $1 AND location_id = $2`,
    [sku, locatieId]
  );
  const verwacht = Number(huidig?.qty ?? 0);
  if (verwacht === geteld) return { boekingId: null, verwacht, verschil: 0 };

  try {
    /* De CTE leest het saldo opnieuw mét lock en boekt in hetzelfde statement,
       zodat het verschil klopt ook als er tussen de twee calls gepikt werd. */
    const rij = await queryOne<{ id: number; qty: number }>(
      `WITH huidig AS (
         SELECT qty FROM wms.stock_levels
          WHERE sku = $1 AND location_id = $2
          FOR UPDATE
       ), saldo AS (
         SELECT coalesce((SELECT qty FROM huidig), 0) AS aanwezig
       )
       INSERT INTO wms.stock_moves
         (sku, from_location_id, to_location_id, qty, reason,
          actor_id, actor_name, note, idempotency_key)
       SELECT $1,
              CASE WHEN $3 < saldo.aanwezig THEN $2 ELSE NULL END,
              CASE WHEN $3 > saldo.aanwezig THEN $2 ELSE NULL END,
              abs($3 - saldo.aanwezig),
              'telling', $4, $5, $6, $7
         FROM saldo
        WHERE saldo.aanwezig <> $3
       RETURNING id, qty`,
      [
        sku,
        locatieId,
        geteld,
        args.actorId ?? null,
        args.actorNaam ?? null,
        args.notitie ?? null,
        args.idempotencyKey ?? null,
      ]
    );
    /* Niets geboekt betekent dat het saldo intussen al gelijk was aan het
       getelde aantal — geen fout, wel het melden waard in de UI. */
    if (!rij) return { boekingId: null, verwacht, verschil: 0 };
    return { boekingId: rij.id, verwacht, verschil: geteld - verwacht };
  } catch (err) {
    throw vertaalDbFout(err);
  }
}

/* ── Shadow-fase ───────────────────────────────────────────────────────────── */

/** Actuele afwijking t.o.v. de laatste SRS-spiegel van branch 99 (Magazijn). */
export async function shadowVerschillen(limiet = 100): Promise<ShadowRegel[]> {
  return query<ShadowRegel>(
    `SELECT v.*, a.omschrijving
       FROM wms.shadow_verschil v
       LEFT JOIN wms.artikelen a ON a.sku = v.sku
      WHERE v.diff <> 0
      ORDER BY abs(v.diff) DESC, v.sku
      LIMIT $1`,
    [limiet]
  );
}

export interface ShadowSamenvatting {
  srs_skus: number;
  wms_skus: number;
  srs_stuks: number;
  wms_stuks: number;
  skus_met_verschil: number;
  stuks_verschil: number;
}

export async function shadowSamenvatting(): Promise<ShadowSamenvatting> {
  const rij = await queryOne<Record<string, string>>(
    `SELECT count(*) FILTER (WHERE srs_qty > 0)::int  AS srs_skus,
            count(*) FILTER (WHERE wms_qty > 0)::int  AS wms_skus,
            coalesce(sum(srs_qty), 0)::int            AS srs_stuks,
            coalesce(sum(wms_qty), 0)::int            AS wms_stuks,
            count(*) FILTER (WHERE diff <> 0)::int    AS skus_met_verschil,
            coalesce(sum(abs(diff)), 0)::int          AS stuks_verschil
       FROM wms.shadow_verschil`
  );
  return {
    srs_skus: Number(rij?.srs_skus ?? 0),
    wms_skus: Number(rij?.wms_skus ?? 0),
    srs_stuks: Number(rij?.srs_stuks ?? 0),
    wms_stuks: Number(rij?.wms_stuks ?? 0),
    skus_met_verschil: Number(rij?.skus_met_verschil ?? 0),
    stuks_verschil: Number(rij?.stuks_verschil ?? 0),
  };
}

/* ── Dashboardcijfers ──────────────────────────────────────────────────────── */

export interface Kerncijfers {
  locaties: number;
  bezette_locaties: number;
  skus: number;
  stuks: number;
  boekingen_vandaag: number;
}

export async function kerncijfers(): Promise<Kerncijfers> {
  const rij = await queryOne<Record<string, string>>(
    `SELECT (SELECT count(*) FROM wms.locations WHERE active)::int          AS locaties,
            (SELECT count(DISTINCT location_id) FROM wms.stock_levels
              WHERE qty > 0)::int                                            AS bezette_locaties,
            (SELECT count(DISTINCT sku) FROM wms.stock_levels WHERE qty > 0)::int AS skus,
            (SELECT coalesce(sum(qty), 0) FROM wms.stock_levels)::int        AS stuks,
            (SELECT count(*) FROM wms.stock_moves
              WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Amsterdam'))::int
                                                                             AS boekingen_vandaag`
  );
  return {
    locaties: Number(rij?.locaties ?? 0),
    bezette_locaties: Number(rij?.bezette_locaties ?? 0),
    skus: Number(rij?.skus ?? 0),
    stuks: Number(rij?.stuks ?? 0),
    boekingen_vandaag: Number(rij?.boekingen_vandaag ?? 0),
  };
}
