/**
 * Read-only: hoe legt de core vast wíé een orderregel uitlevert? Bepaalt of het
 * magazijn zijn pickwerk uit `orders` kan halen of alleen uit transfers.
 *
 *   node scripts/db-fulfilment.mjs
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

console.log("== orders.fulfillment_status");
for (const r of await sql`
  SELECT coalesce(nullif(fulfillment_status, ''), '(leeg)') AS status, count(*)::int AS n
    FROM public.orders GROUP BY 1 ORDER BY n DESC LIMIT 10`) {
  console.log(`   ${String(r.status).padEnd(20)} ${r.n}`);
}

console.log("\n== orders met een gevuld fulfillment_plan");
const [telling] = await sql`
  SELECT count(*) FILTER (WHERE fulfillment_plan IS NOT NULL
                            AND fulfillment_plan::text NOT IN ('null', '{}', '[]'))::int AS met_plan,
         count(*)::int AS totaal
    FROM public.orders`;
console.log(`   ${telling.met_plan} van ${telling.totaal}`);

const voorbeeld = await sql`
  SELECT order_number, fulfillment_status, fulfillment_plan
    FROM public.orders
   WHERE fulfillment_plan IS NOT NULL
     AND fulfillment_plan::text NOT IN ('null', '{}', '[]')
   ORDER BY created_at DESC LIMIT 2`;
for (const o of voorbeeld) {
  console.log(`\n   order ${o.order_number} (${o.fulfillment_status || "geen status"})`);
  console.log("   ", JSON.stringify(o.fulfillment_plan).slice(0, 700));
}

console.log("\n== zendingen vanuit het magazijn per status");
for (const r of await sql`
  SELECT status, count(*)::int AS n, sum(jsonb_array_length(expected_lines))::int AS regels
    FROM public.inbound_shipments
   WHERE from_location ILIKE '%magazijn%'
   GROUP BY 1 ORDER BY n DESC`) {
  console.log(`   ${String(r.status).padEnd(12)} ${r.n} zendingen, ${r.regels} regels`);
}
