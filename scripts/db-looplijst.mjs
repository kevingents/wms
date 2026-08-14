/**
 * Read-only: wat zit er in de SRS-velden `ideaal` en `tekort`? Bepaalt of het
 * WMS aanvullijsten kan afleiden of dat die logica ergens anders hoort.
 *
 *   node scripts/db-looplijst.mjs
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
const [{ gen }] = await sql`SELECT gen FROM public.srs_stock ORDER BY created_at DESC LIMIT 1`;

console.log("== dekking van ideaal/tekort in de laatste peiling");
const [dek] = await sql`
  SELECT count(*)::int                                   AS rijen,
         count(*) FILTER (WHERE ideaal > 0)::int          AS met_ideaal,
         count(*) FILTER (WHERE tekort > 0)::int          AS met_tekort,
         coalesce(sum(tekort), 0)::int                    AS stuks_tekort
    FROM public.srs_stock WHERE gen = ${gen}`;
console.log(
  `   ${dek.rijen} rijen · ${dek.met_ideaal} met ideaal · ${dek.met_tekort} met tekort · ${dek.stuks_tekort} stuks tekort`
);

console.log("\n== tekort per winkel (top 12)");
for (const r of await sql`
  SELECT branch_id, store,
         count(*) FILTER (WHERE tekort > 0)::int AS skus_tekort,
         coalesce(sum(tekort), 0)::int            AS stuks_tekort,
         coalesce(sum(ideaal), 0)::int            AS ideaal,
         coalesce(sum(qty), 0)::int               AS aanwezig
    FROM public.srs_stock WHERE gen = ${gen}
   GROUP BY branch_id, store
  HAVING sum(tekort) > 0
   ORDER BY sum(tekort) DESC LIMIT 12`) {
  console.log(
    `   ${String(r.branch_id).padEnd(4)} ${String(r.store).padEnd(22)} ${String(r.skus_tekort).padStart(5)} sku's · ${String(r.stuks_tekort).padStart(6)} tekort · ${String(r.aanwezig).padStart(6)}/${r.ideaal} aanwezig/ideaal`
  );
}

console.log("\n== magazijn (99): eigen ideaal/tekort?");
const [mag] = await sql`
  SELECT count(*)::int AS rijen,
         count(*) FILTER (WHERE ideaal > 0)::int AS met_ideaal,
         count(*) FILTER (WHERE tekort > 0)::int AS met_tekort,
         coalesce(sum(qty), 0)::int AS stuks
    FROM public.srs_stock WHERE gen = ${gen} AND branch_id = '99'`;
console.log(
  `   ${mag.rijen} sku's · ${mag.met_ideaal} met ideaal · ${mag.met_tekort} met tekort · ${mag.stuks} stuks`
);

console.log("\n== kan het magazijn de tekorten dekken? (top 10 tekorten)");
for (const r of await sql`
  WITH tekorten AS (
    SELECT sku, sum(tekort)::int AS tekort
      FROM public.srs_stock
     WHERE gen = ${gen} AND branch_id <> '99' AND tekort > 0
     GROUP BY sku
  ), magazijn AS (
    SELECT sku, sum(qty)::int AS op_voorraad
      FROM public.srs_stock WHERE gen = ${gen} AND branch_id = '99'
     GROUP BY sku
  )
  SELECT t.sku, t.tekort, coalesce(m.op_voorraad, 0) AS magazijn
    FROM tekorten t LEFT JOIN magazijn m ON m.sku = t.sku
   ORDER BY t.tekort DESC LIMIT 10`) {
  console.log(
    `   ${String(r.sku).padEnd(16)} tekort ${String(r.tekort).padStart(4)} · magazijn ${String(r.magazijn).padStart(4)}`
  );
}

const [dekking] = await sql`
  WITH tekorten AS (
    SELECT sku, sum(tekort)::int AS tekort
      FROM public.srs_stock
     WHERE gen = ${gen} AND branch_id <> '99' AND tekort > 0
     GROUP BY sku
  ), magazijn AS (
    SELECT sku, sum(qty)::int AS op_voorraad
      FROM public.srs_stock WHERE gen = ${gen} AND branch_id = '99'
     GROUP BY sku
  )
  SELECT count(*)::int AS skus_tekort,
         sum(t.tekort)::int AS stuks_tekort,
         sum(least(t.tekort, coalesce(m.op_voorraad, 0)))::int AS leverbaar
    FROM tekorten t LEFT JOIN magazijn m ON m.sku = t.sku`;
console.log(
  `\n   ${dekking.skus_tekort} sku's met tekort in winkels, ${dekking.stuks_tekort} stuks;` +
    ` daarvan ${dekking.leverbaar} direct leverbaar uit het magazijn.`
);
