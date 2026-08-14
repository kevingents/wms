/**
 * Ruimt testresten op die de smoke-tests achterlaten.
 *
 * De smoke-tests draaien tegen de echte database en gebruiken herkenbare
 * prefixen (`ZZ-`). Werkproces-tabellen mogen weg; het grootboek blijft staan,
 * want dat is append-only en dat is precies de bedoeling — testboekingen onder
 * sku ZZ-TEST-SKU zijn zichtbaar en verklaarbaar.
 *
 *   node scripts/db-testdata-opruimen.mjs
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

const [koppeling] = await sql`
  DELETE FROM wms.koppeling_uitgaand k
   USING wms.pick_orders o
   WHERE k.pick_order_id = o.id AND o.code LIKE 'ZZ-%'
  RETURNING 1`.then((r) => [r.length]);

const rondes = await sql`DELETE FROM wms.pick_rondes WHERE code LIKE 'ZZ-%' RETURNING 1`;
const orders = await sql`DELETE FROM wms.pick_orders WHERE code LIKE 'ZZ-%' RETURNING 1`;
const levels = await sql`DELETE FROM wms.stock_levels WHERE sku LIKE 'ZZ-%' RETURNING 1`;
const locaties = await sql`
  UPDATE wms.locations SET active = false
   WHERE code LIKE 'ZZ-%' AND active RETURNING 1`;

console.log(`Opgeruimd:
  koppeling-berichten : ${koppeling}
  pickrondes          : ${rondes.length}
  pickopdrachten      : ${orders.length}
  saldi               : ${levels.length}
  locaties inactief   : ${locaties.length}

Het grootboek blijft staan (append-only). Testboekingen zijn herkenbaar aan
sku ZZ-TEST-SKU en actor 'smoke'.`);
