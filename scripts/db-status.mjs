/**
 * Read-only statusoverzicht van het WMS-schema. Handig na een migratie en als
 * snelle check of de shadow-vergelijking iets zinnigs oplevert.
 *
 *   node scripts/db-status.mjs
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

const objecten = await sql`
  SELECT c.relname AS naam,
         CASE c.relkind WHEN 'r' THEN 'tabel' WHEN 'v' THEN 'view' ELSE c.relkind::text END AS soort
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'wms' AND c.relkind IN ('r', 'v')
   ORDER BY c.relkind DESC, c.relname`;

console.log("Schema wms\n");
for (const o of objecten) {
  if (o.soort === "tabel") {
    const [{ n }] = await sql.query(`SELECT count(*)::int AS n FROM wms.${o.naam}`);
    console.log(`  ${o.soort.padEnd(6)} ${o.naam.padEnd(24)} ${n} rijen`);
  } else {
    console.log(`  ${o.soort.padEnd(6)} ${o.naam}`);
  }
}

const [samenvatting] = await sql`
  SELECT count(*) FILTER (WHERE srs_qty > 0)::int AS srs_skus,
         count(*) FILTER (WHERE wms_qty > 0)::int AS wms_skus,
         coalesce(sum(srs_qty), 0)::int           AS srs_stuks,
         coalesce(sum(wms_qty), 0)::int           AS wms_stuks,
         count(*) FILTER (WHERE diff <> 0)::int   AS met_verschil
    FROM wms.shadow_verschil`;

console.log("\nShadow-vergelijking (SRS branch 99 vs WMS)");
console.log(`  SRS : ${samenvatting.srs_stuks} stuks over ${samenvatting.srs_skus} sku's`);
console.log(`  WMS : ${samenvatting.wms_stuks} stuks over ${samenvatting.wms_skus} sku's`);
console.log(`  sku's met verschil: ${samenvatting.met_verschil}`);

/* Scanbaarheid. Een sku zonder barcode is in het magazijn alleen met de hand in
   te tikken — dat is de praktische bovengrens van wat er gescand kan worden. */
const [dekking] = await sql`
  WITH mag AS (
    SELECT DISTINCT sku FROM public.srs_stock
     WHERE branch_id = '99' AND qty > 0
       AND gen = (SELECT gen FROM public.srs_stock ORDER BY created_at DESC LIMIT 1)
  )
  SELECT count(*)::int         AS magazijn_skus,
         count(a.sku)::int     AS bekend,
         count(a.barcode)::int AS met_barcode
    FROM mag LEFT JOIN wms.artikelen a ON a.sku = mag.sku`;

const pct = (n) =>
  dekking.magazijn_skus ? `${Math.round((n / dekking.magazijn_skus) * 100)}%` : "—";

/* Hoeveel pickwerk staat er klaar in de core, los van wat al geïmporteerd is. */
const [pickwerk] = await sql`
  WITH magazijn AS (
    SELECT o.order_number,
           jsonb_array_length(
             coalesce(jsonb_path_query_array(
               o.fulfillment_plan->'shipments',
               '$[*] ? (@.branchId == "99" || @.isWarehouse == true)'), '[]'::jsonb)
           ) AS zendingen
      FROM public.orders o
     WHERE o.fulfillment_status IN ('planned', 'pending')
       AND o.fulfillment_plan->'shipments' IS NOT NULL
  )
  SELECT count(*) FILTER (WHERE zendingen > 0)::int AS orders_voor_magazijn,
         count(*)::int AS orders_gepland
    FROM magazijn`;

const [geimporteerd] = await sql`
  SELECT count(*) FILTER (WHERE status IN ('open', 'bezig'))::int AS werkvoorraad,
         count(*)::int AS totaal
    FROM wms.pick_orders`;

console.log("\nPickwerk");
console.log(`  orders met status planned/pending : ${pickwerk.orders_gepland}`);
console.log(`  daarvan toegewezen aan magazijn   : ${pickwerk.orders_voor_magazijn}`);
console.log(`  pickopdrachten in het WMS         : ${geimporteerd.totaal} (${geimporteerd.werkvoorraad} open)`);

console.log("\nScanbaarheid van de magazijnvoorraad");
console.log(`  sku's met voorraad in SRS : ${dekking.magazijn_skus}`);
console.log(`  bekend in product_variants: ${dekking.bekend} (${pct(dekking.bekend)})`);
console.log(`  daarvan met barcode       : ${dekking.met_barcode} (${pct(dekking.met_barcode)})`);
