/**
 * Read-only inspectie van de database. Toont welke schema's en tabellen er zijn
 * en hoe groot ze zijn. Schrijft niets. Handig vóór een migratie en als je wilt
 * weten of het WMS-schema al staat.
 *
 *   node scripts/db-inspect.mjs
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon } from "@neondatabase/serverless";

const hier = dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  try {
    const tekst = await readFile(join(hier, "..", ".env.local"), "utf8");
    for (const regel of tekst.split(/\r?\n/)) {
      const m = regel.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* geen .env.local */
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL ontbreekt.");
  process.exit(1);
}

const sql = neon(url);

const host = url.match(/@([^/]+)\//)?.[1] ?? "?";
console.log(`Database: ${host}\n`);

const schemas = await sql`
  SELECT nspname AS schema
    FROM pg_namespace
   WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
   ORDER BY nspname`;
console.log("Schema's:", schemas.map((r) => r.schema).join(", "), "\n");

const tabellen = await sql`
  SELECT table_schema AS schema, table_name AS tabel,
         (SELECT count(*) FROM information_schema.columns c
           WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name) AS kolommen
    FROM information_schema.tables t
   WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
     AND table_type = 'BASE TABLE'
   ORDER BY table_schema, table_name`;

let vorig = "";
for (const r of tabellen) {
  if (r.schema !== vorig) {
    console.log(`\n[${r.schema}]`);
    vorig = r.schema;
  }
  console.log(`  ${r.tabel.padEnd(32)} ${r.kolommen} kolommen`);
}
console.log(`\nTotaal ${tabellen.length} tabellen.`);
