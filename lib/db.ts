import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Database-laag — Neon serverless Postgres (HTTP-driver).
 *
 * Waarom HTTP en niet een klassieke pool: Vercel-functions schalen horizontaal,
 * een gewone pg-Pool put dan de connecties van de database uit. De HTTP-driver
 * heeft geen persistente connectie.
 *
 * Let op de belangrijkste beperking: de HTTP-driver voert ÉÉN statement per call
 * uit. Er is dus geen interactieve transactie (lezen → beslissen → schrijven
 * binnen één BEGIN/COMMIT). Dat is hier bewust geen probleem:
 *
 *   - Eén boeking = één INSERT in `stock_moves`; de trigger werkt de saldi in
 *     dezelfde impliciete transactie bij. Atomair, zonder BEGIN.
 *   - Meerdere boekingen tegelijk (multi-regel ontvangst) → `sql.transaction([…])`,
 *     dat stuurt de statements als één transactie in één request.
 *   - Lezen-en-dan-schrijven (telling) lost `boekTelling()` op met één statement
 *     met een CTE + FOR UPDATE.
 *
 * Heb je later tóch een interactieve transactie nodig (bv. golf-picking over
 * meerdere orders), gebruik dan `Pool` uit ditzelfde pakket over WebSockets.
 */

let _sql: NeonQueryFunction<false, false> | null = null;

export function dbUrl(): string {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.WMS_DATABASE_URL ||
    ""
  ).trim();
}

export function isDbConfigured(): boolean {
  return Boolean(dbUrl());
}

/** Lazy Neon-client. Gooit als er geen connectie-string is. */
export function sql(): NeonQueryFunction<false, false> {
  if (_sql) return _sql;
  const url = dbUrl();
  if (!url) {
    throw new Error("DATABASE_URL ontbreekt — het WMS kan niet zonder database.");
  }
  _sql = neon(url);
  return _sql;
}

/** Query met parameters. Gebruik dit i.p.v. string-interpolatie. */
export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const rows = await sql().query(text, params as never[]);
  return rows as T[];
}

/** Eerste rij, of null. */
export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/* ── Foutvertaling ─────────────────────────────────────────────────────────
   Postgres-fouten zijn voor een magazijnmedewerker onleesbaar. We vertalen de
   handvol die in de praktijk voorkomt naar iets waar iemand met een scanner in
   z'n hand wat mee kan. De rest wordt generiek — nooit rauwe SQL in de UI. */

export class BoekingsFout extends Error {
  readonly code: string;
  constructor(message: string, code = "boeking_geweigerd") {
    super(message);
    this.name = "BoekingsFout";
    this.code = code;
  }
}

interface PgFout {
  code?: string;
  constraint?: string;
  message?: string;
}

export function vertaalDbFout(err: unknown): BoekingsFout {
  const e = err as PgFout;
  const constraint = e?.constraint || "";
  const melding = String(e?.message || "");

  if (e?.code === "23514" || /levels_niet_negatief/.test(melding)) {
    if (constraint === "levels_niet_negatief_chk" || /levels_niet_negatief/.test(melding)) {
      return new BoekingsFout(
        "Zoveel ligt hier niet — de locatie zou negatief worden. Tel de locatie opnieuw.",
        "voorraad_ontoereikend"
      );
    }
    if (/moves_niet_zelfde/.test(melding)) {
      return new BoekingsFout("Van- en naar-locatie zijn hetzelfde.", "zelfde_locatie");
    }
    if (/moves_qty/.test(melding)) {
      return new BoekingsFout("Aantal moet groter dan 0 zijn.", "ongeldig_aantal");
    }
    return new BoekingsFout("Boeking geweigerd — controleer de ingevoerde waarden.");
  }

  if (e?.code === "23505") {
    return new BoekingsFout("Deze boeking is al verwerkt.", "dubbel");
  }

  if (e?.code === "23503") {
    return new BoekingsFout("Onbekend artikel of onbekende locatie.", "onbekend");
  }

  if (/append-only/.test(melding)) {
    return new BoekingsFout(
      "Boekingen kunnen niet gewijzigd worden — maak een tegenboeking.",
      "append_only"
    );
  }

  return new BoekingsFout("Er ging iets mis bij het boeken. Probeer opnieuw.");
}
