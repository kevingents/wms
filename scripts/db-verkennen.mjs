/**
 * Read-only verkenning van de bestaande voorraad-tabellen. Schrijft niets.
 * Gebruikt om te bepalen wáár het WMS op aansluit i.p.v. iets te dupliceren.
 *
 *   node scripts/db-verkennen.mjs
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

console.log("== srs_stock: branches (top 12 op aantal SKU's)");
for (const r of await sql`
  SELECT branch_id, store, count(*)::int AS skus, sum(qty)::int AS stuks
    FROM public.srs_stock GROUP BY branch_id, store
   ORDER BY skus DESC LIMIT 12`) {
  console.log(
    `   branch ${String(r.branch_id).padEnd(5)} ${String(r.store).padEnd(24)} ${String(r.skus).padStart(6)} sku's  ${String(r.stuks).padStart(7)} stuks`
  );
}

console.log("\n== srs_stock: generaties (gen)");
for (const r of await sql`
  SELECT gen, count(*)::int AS n, max(created_at) AS laatste
    FROM public.srs_stock GROUP BY gen ORDER BY max(created_at) DESC LIMIT 5`) {
  console.log(`   ${r.gen}  ${r.n} rijen  laatste ${r.laatste}`);
}

console.log("\n== store_stock_movements: locaties + redenen");
for (const r of await sql`
  SELECT location, reason, channel, count(*)::int AS n
    FROM public.store_stock_movements
   GROUP BY location, reason, channel ORDER BY n DESC LIMIT 15`) {
  console.log(
    `   ${String(r.location).padEnd(14)} ${String(r.reason).padEnd(20)} ${String(r.channel).padEnd(10)} ${r.n}x`
  );
}

console.log("\n== stock_key: hoe ziet die eruit? (voorbeelden)");
for (const r of await sql`
  SELECT DISTINCT stock_key FROM public.store_stock_movements LIMIT 5`) {
  console.log(`   ${r.stock_key}`);
}

console.log("\n== inbound_shipments: bronnen en statussen");
for (const r of await sql`
  SELECT source_type, from_location, status, count(*)::int AS n
    FROM public.inbound_shipments
   GROUP BY source_type, from_location, status ORDER BY n DESC LIMIT 12`) {
  console.log(
    `   ${String(r.source_type).padEnd(12)} van ${String(r.from_location || "-").padEnd(14)} ${String(r.status).padEnd(12)} ${r.n}x`
  );
}

console.log("\n== product_variants: dekking sleutels");
const dek = (
  await sql`
  SELECT count(*)::int AS totaal,
         count(*) FILTER (WHERE sku <> '')::int AS met_sku,
         count(*) FILTER (WHERE barcode <> '')::int AS met_barcode,
         count(*) FILTER (WHERE srs_artikel_id <> '')::int AS met_srs,
         count(DISTINCT sku)::int AS unieke_sku
    FROM public.product_variants`
)[0];
console.log(
  `   ${dek.totaal} varianten · ${dek.met_sku} met sku (${dek.unieke_sku} uniek) · ${dek.met_barcode} met barcode · ${dek.met_srs} met srs_artikel_id`
);
