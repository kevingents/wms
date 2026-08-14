/**
 * Migratie-runner. Voert db/schema.sql statement voor statement uit tegen Neon.
 *
 * De HTTP-driver van Neon doet één statement per call, dus splitsen we het
 * bestand op regels die exact `--;;` zijn. Alles is idempotent — dit script mag
 * zo vaak draaien als je wilt.
 *
 *   npm run db:migrate
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon } from "@neondatabase/serverless";

const hier = dirname(fileURLToPath(import.meta.url));

function dbUrl() {
  const url = (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.WMS_DATABASE_URL ||
    ""
  ).trim();
  if (!url) {
    console.error(
      "DATABASE_URL ontbreekt. Zet 'm in .env.local of geef 'm mee:\n" +
        "  DATABASE_URL=postgres://... npm run db:migrate"
    );
    process.exit(1);
  }
  return url;
}

/** Leest .env.local in als de var nog niet in de omgeving staat. */
async function laadEnvLocal() {
  if (process.env.DATABASE_URL) return;
  try {
    const tekst = await readFile(join(hier, "..", ".env.local"), "utf8");
    for (const regel of tekst.split(/\r?\n/)) {
      const m = regel.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const waarde = m[2].replace(/^["']|["']$/g, "");
      if (!process.env[m[1]]) process.env[m[1]] = waarde;
    }
  } catch {
    /* geen .env.local — prima, dan komt de var uit de omgeving */
  }
}

await laadEnvLocal();

const sql = neon(dbUrl());

/* Volgorde telt: schema-2 verwijst naar tabellen en views uit schema.sql. */
const BESTANDEN = ["schema.sql", "schema-2.sql", "schema-3.sql"];

let totaal = 0;

for (const naam of BESTANDEN) {
  const bestand = await readFile(join(hier, "..", "db", naam), "utf8");

  const statements = bestand
    .split(/^\s*--;;\s*$/m)
    .map((s) => s.replace(/^[ \t]*--[^\n]*\n?/gm, "").trim())
    .filter(Boolean);

  console.log(`\n${naam} — ${statements.length} statements`);

  for (const statement of statements) {
    const kop = statement.split("\n")[0].slice(0, 72);
    try {
      await sql.query(statement);
      totaal += 1;
      console.log(`  ok   ${kop}`);
    } catch (err) {
      console.error(`  FOUT ${kop}\n       ${err?.message || err}`);
      process.exit(1);
    }
  }
}

console.log(`\nKlaar — ${totaal} statements uitgevoerd.`);
