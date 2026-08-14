import { query, queryOne, BoekingsFout, vertaalDbFout } from "./db";
import { zoekLocatie } from "./voorraad";
import { instelling } from "./instellingen";

/**
 * Inslag — voorraad het systeem in krijgen.
 *
 * Twee dingen die niet op elkaar lijken maar hetzelfde probleem oplossen:
 *
 * 1. `laadBeginvoorraad()` — de eenmalige go-live. De complete SRS-voorraad van
 *    branch 99 wordt in één statement naar de wachtlocatie ONBEKEND geboekt.
 *    Vanaf dat moment is het shadow-verschil nul en klopt het WMS op totalen,
 *    terwijl de exacte plek nog onbekend is. Dat is hoe een WMS-go-live hoort te
 *    lopen: eerst kloppen op totaal, dan verfijnen op locatie. Het alternatief —
 *    4.285 sku's met de hand inscannen voordat je iets kunt — kost weken en
 *    levert een systeem op dat al die tijd niet klopt.
 *
 * 2. De vloer verhuist die voorraad daarna scannend naar echte vakken. Dat loopt
 *    via de gewone verplaatsingsboeking; het WMS staat geen moment "verkeerd".
 */

export interface BeginvoorraadResultaat {
  gen: string;
  skus: number;
  stuks: number;
  locatie: string;
}

/** Is de beginvoorraad al een keer geladen? Dit is een eenmalige actie. */
export async function beginvoorraadGeladen(): Promise<boolean> {
  const rij = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM wms.stock_moves WHERE reason = 'startsaldo'`
  );
  return Number(rij?.n ?? 0) > 0;
}

export interface BeginvoorraadVoorbeeld {
  gen: string | null;
  gepeild_op: string | null;
  skus: number;
  stuks: number;
  alGeladen: boolean;
}

/** Wat zou er geladen worden? Voor het bevestigingsscherm. */
export async function beginvoorraadVoorbeeld(): Promise<BeginvoorraadVoorbeeld> {
  const bron = await queryOne<Record<string, string>>(
    `WITH laatste AS (
       SELECT gen, max(created_at) AS gepeild_op
         FROM public.srs_stock GROUP BY gen ORDER BY 2 DESC LIMIT 1
     )
     SELECT l.gen,
            l.gepeild_op::text,
            count(DISTINCT s.sku)::text AS skus,
            coalesce(sum(s.qty), 0)::text AS stuks
       FROM laatste l
       JOIN public.srs_stock s ON s.gen = l.gen AND s.branch_id = '99' AND s.qty > 0
      GROUP BY l.gen, l.gepeild_op`
  );

  return {
    gen: bron?.gen ?? null,
    gepeild_op: bron?.gepeild_op ?? null,
    skus: Number(bron?.skus ?? 0),
    stuks: Number(bron?.stuks ?? 0),
    alGeladen: await beginvoorraadGeladen(),
  };
}

/**
 * Boekt de SRS-magazijnvoorraad als startsaldo.
 *
 * Eén statement voor alle ~4.300 sku's: de HTTP-driver zou 4.300 losse calls
 * niet binnen een functie-timeout redden, en dit is bovendien atomair — het
 * lukt helemaal of niet.
 *
 * De idempotency-sleutel bevat de SRS-generatie, dus tweemaal draaien op
 * dezelfde peiling doet niets. Draaien op een níeuwe peiling zou de voorraad
 * verdubbelen, en daarom weigeren we sowieso als er al een startsaldo staat.
 */
export async function laadBeginvoorraad(
  door: string | null
): Promise<BeginvoorraadResultaat> {
  if (await beginvoorraadGeladen()) {
    throw new BoekingsFout(
      "De beginvoorraad is al geladen. Corrigeer verschillen met tellingen, niet met een tweede import.",
      "al_geladen"
    );
  }

  const code = String(await instelling<string>("inslag.startlocatie")) || "ONBEKEND";
  const locatie = await zoekLocatie(code);
  if (!locatie) {
    throw new BoekingsFout(`Wachtlocatie "${code}" bestaat niet.`, "geen_locatie");
  }

  const laatste = await queryOne<{ gen: string }>(
    `SELECT gen FROM public.srs_stock ORDER BY created_at DESC LIMIT 1`
  );
  if (!laatste?.gen) {
    throw new BoekingsFout("Er staat geen SRS-voorraadspiegel in de database.", "geen_bron");
  }

  try {
    await query(
      `INSERT INTO wms.stock_moves
         (sku, to_location_id, qty, reason, actor_name, note, idempotency_key)
       SELECT s.sku, $1, sum(s.qty)::int, 'startsaldo', $2,
              'Beginvoorraad uit SRS branch 99',
              'startsaldo:' || $3 || ':' || s.sku
         FROM public.srs_stock s
        WHERE s.branch_id = '99' AND s.gen = $3 AND s.qty > 0
        GROUP BY s.sku
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [locatie.id, door, laatste.gen]
    );
  } catch (err) {
    throw vertaalDbFout(err);
  }

  const totaal = await queryOne<Record<string, string>>(
    `SELECT count(*)::text AS skus, coalesce(sum(qty), 0)::text AS stuks
       FROM wms.stock_levels WHERE location_id = $1`,
    [locatie.id]
  );

  return {
    gen: laatste.gen,
    skus: Number(totaal?.skus ?? 0),
    stuks: Number(totaal?.stuks ?? 0),
    locatie: locatie.code,
  };
}

/* ── Voortgang van het indelen ─────────────────────────────────────────────── */

export interface IndeelVoortgang {
  wachtend_skus: number;
  wachtend_stuks: number;
  ingedeeld_skus: number;
  ingedeeld_stuks: number;
}

/**
 * Hoe ver is het magazijn met het verhuizen van de wachtlocatie naar echte
 * vakken? Dit is het cijfer dat tijdens de inrichting elke dag omhoog moet.
 */
export async function indeelVoortgang(): Promise<IndeelVoortgang> {
  const code = String(await instelling<string>("inslag.startlocatie")) || "ONBEKEND";
  const rij = await queryOne<Record<string, string>>(
    `SELECT
       coalesce(count(*) FILTER (WHERE l.code = $1), 0)::text          AS wachtend_skus,
       coalesce(sum(s.qty) FILTER (WHERE l.code = $1), 0)::text        AS wachtend_stuks,
       coalesce(count(*) FILTER (WHERE l.code <> $1), 0)::text         AS ingedeeld_skus,
       coalesce(sum(s.qty) FILTER (WHERE l.code <> $1), 0)::text       AS ingedeeld_stuks
     FROM wms.stock_levels s
     JOIN wms.locations l ON l.id = s.location_id
    WHERE s.qty > 0`,
    [code]
  );
  return {
    wachtend_skus: Number(rij?.wachtend_skus ?? 0),
    wachtend_stuks: Number(rij?.wachtend_stuks ?? 0),
    ingedeeld_skus: Number(rij?.ingedeeld_skus ?? 0),
    ingedeeld_stuks: Number(rij?.ingedeeld_stuks ?? 0),
  };
}
