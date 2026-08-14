/**
 * Read-only: toont kolommen + rijaantal van de opgegeven tabellen.
 *
 *   node scripts/db-kolommen.mjs stock_levels store_stock_movements
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

const sql = neon(process.env.DATABASE_URL);
const tabellen = process.argv.slice(2);

for (const tabel of tabellen) {
  const kolommen = await sql`
    SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ${tabel}
     ORDER BY ordinal_position`;

  if (!kolommen.length) {
    console.log(`\n== ${tabel} — BESTAAT NIET`);
    continue;
  }

  const telling = await sql.query(`SELECT count(*)::int AS n FROM public.${tabel}`);
  console.log(`\n== ${tabel}  (${telling[0].n} rijen)`);
  for (const k of kolommen) {
    const def = k.column_default ? ` default ${String(k.column_default).slice(0, 40)}` : "";
    console.log(
      `   ${k.column_name.padEnd(28)} ${k.data_type}${k.is_nullable === "NO" ? " NOT NULL" : ""}${def}`
    );
  }
}
