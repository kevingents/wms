/**
 * Read-only: waar zouden pickopdrachten vandaan komen? Kijkt naar de
 * order-stroom en de transfers vanuit het magazijn.
 *
 *   node scripts/db-orders.mjs
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

console.log("== orders: kanaal / status / fulfilment");
for (const r of await sql`
  SELECT channel, status, fulfillment_status, count(*)::int AS n
    FROM public.orders GROUP BY 1, 2, 3 ORDER BY n DESC LIMIT 15`.catch(
  async () =>
    sql`SELECT status, count(*)::int AS n FROM public.orders GROUP BY 1 ORDER BY n DESC LIMIT 15`
)) {
  console.log("  ", JSON.stringify(r));
}

console.log("\n== orders: welke kolommen wijzen naar een winkel/locatie?");
for (const r of await sql`
  SELECT column_name, data_type FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'orders'
     AND (column_name ILIKE '%store%' OR column_name ILIKE '%branch%'
          OR column_name ILIKE '%location%' OR column_name ILIKE '%fulfil%'
          OR column_name ILIKE '%status%' OR column_name ILIKE '%channel%')
   ORDER BY ordinal_position`) {
  console.log(`   ${r.column_name.padEnd(28)} ${r.data_type}`);
}

console.log("\n== inbound_shipments vanuit het magazijn: hoe zien expected_lines eruit?");
const zending = await sql`
  SELECT id, source_type, from_location, to_store, status, parts, expected_lines
    FROM public.inbound_shipments
   WHERE from_location ILIKE '%magazijn%'
   ORDER BY created_at DESC LIMIT 1`;
if (zending.length) {
  const z = zending[0];
  console.log(`   ${z.source_type} van ${z.from_location} naar ${z.to_store} (${z.status})`);
  const regels = Array.isArray(z.expected_lines) ? z.expected_lines : [];
  console.log(`   ${regels.length} regels, eerste twee:`);
  for (const r of regels.slice(0, 2)) console.log("   ", JSON.stringify(r));
} else {
  console.log("   geen zending met from_location = magazijn");
}

console.log("\n== inbound_shipments: recente, ongeacht herkomst");
for (const r of await sql`
  SELECT source_type, from_location, to_store, status,
         jsonb_array_length(expected_lines) AS regels, created_at
    FROM public.inbound_shipments
   ORDER BY created_at DESC LIMIT 6`) {
  console.log(
    `   ${String(r.source_type).padEnd(11)} ${String(r.from_location || "-").padEnd(16)} -> ${String(r.to_store).padEnd(18)} ${String(r.status).padEnd(11)} ${r.regels} regels`
  );
}
