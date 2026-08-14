/**
 * Smoke-test op het batchpicken met bakken.
 *
 * Wat hier getest wordt is wat een pickronde onbruikbaar maakt als het stuk is:
 *   1. één bak per order en één order per bak — een bak met twee orders erin
 *      ontdek je pas bij het inpakken, en dan is het te laat;
 *   2. een order zit in hoogstens één ronde tegelijk, anders lopen twee pickers
 *      dezelfde order en pakt de tweede lucht;
 *   3. de looplijst voegt regels van verschillende orders op hetzelfde vak samen
 *      tot één stop — dat is de hele winst van batchpicken;
 *   4. de stops staan op vakvolgorde (sort_order), niet op ordervolgorde.
 *
 *   node scripts/smoke-rondes.mjs
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
const RUN = `ZZ-RONDE-${Date.now().toString(36)}`;
const SKU_A = "ZZ-TEST-SKU-A";
const SKU_B = "ZZ-TEST-SKU-B";
let mislukt = 0;

function check(naam, geslaagd, detail = "") {
  console.log(`  ${geslaagd ? "ok  " : "FOUT"} ${naam}${detail ? ` — ${detail}` : ""}`);
  if (!geslaagd) mislukt += 1;
}

console.log("Smoke-test pickrondes (batchpicken met bakken)\n");

await sql`DELETE FROM wms.pick_rondes WHERE code LIKE 'ZZ-R%'`;
await sql`DELETE FROM wms.pick_orders WHERE bron_ref LIKE 'ZZ-RONDE-%'`;
await sql`DELETE FROM wms.stock_levels WHERE sku IN (${SKU_A}, ${SKU_B})`;

/* Twee vakken, met opzet in omgekeerde alfabetische volgorde t.o.v. hun
   looproute, zodat we kunnen zien dat er op sort_order gesorteerd wordt. */
const [vakVer] = await sql`
  INSERT INTO wms.locations (code, name, zone, kind, sort_order, pickable)
  VALUES ('ZZ-TEST-A1', 'Achteraan', 'TEST', 'pick', 9200, true)
  ON CONFLICT (code) DO UPDATE SET active = true, sort_order = 9200 RETURNING id`;
const [vakDicht] = await sql`
  INSERT INTO wms.locations (code, name, zone, kind, sort_order, pickable)
  VALUES ('ZZ-TEST-Z1', 'Vooraan', 'TEST', 'pick', 9100, true)
  ON CONFLICT (code) DO UPDATE SET active = true, sort_order = 9100 RETURNING id`;

await sql`
  INSERT INTO wms.stock_moves (sku, to_location_id, qty, reason, actor_name)
  VALUES (${SKU_A}, ${vakVer.id}, 20, 'ontvangst', 'smoke-rondes')`;
await sql`
  INSERT INTO wms.stock_moves (sku, to_location_id, qty, reason, actor_name)
  VALUES (${SKU_B}, ${vakDicht.id}, 20, 'ontvangst', 'smoke-rondes')`;

/* Drie orders. Order 1 en 2 vragen allebei SKU_A van hetzelfde vak — dat moet
   op de looplijst één stop worden met twee bakken. */
const orders = [];
for (const [i, regels] of [
  [[SKU_A, 2, vakVer.id]],
  [[SKU_A, 3, vakVer.id], [SKU_B, 1, vakDicht.id]],
  [[SKU_B, 4, vakDicht.id]],
].entries()) {
  const [o] = await sql`
    INSERT INTO wms.pick_orders (code, bron, bron_ref, bestemming, status)
    VALUES (${`ZZ-P-${RUN}-${i}`}, 'weborder', ${`${RUN}-order-${i}`},
            ${`Klant ${i + 1}`}, 'open')
    RETURNING id`;
  for (const [sku, aantal, loc] of regels) {
    await sql`
      INSERT INTO wms.pick_lines (pick_order_id, sku, gevraagd, location_id, volgorde)
      VALUES (${o.id}, ${sku}, ${aantal}, ${loc},
              (SELECT sort_order FROM wms.locations WHERE id = ${loc}))`;
  }
  orders.push(o.id);
}

/* Ronde met drie bakken. */
const [ronde] = await sql`
  INSERT INTO wms.pick_rondes (code, gestart_naam)
  VALUES (${`ZZ-R-${RUN}`}, 'smoke') RETURNING id`;
for (const [i, orderId] of orders.entries()) {
  await sql`
    INSERT INTO wms.pick_ronde_orders (ronde_id, pick_order_id, bak)
    VALUES (${ronde.id}, ${orderId}, ${i + 1})`;
}

/* 1 — twee orders in dezelfde bak mag niet. */
let dubbeleBakGeweigerd = false;
try {
  await sql`
    INSERT INTO wms.pick_ronde_orders (ronde_id, pick_order_id, bak)
    VALUES (${ronde.id}, ${orders[0]}, 2)`;
} catch (err) {
  dubbeleBakGeweigerd = /pick_ronde_orders_ronde_id_bak_key|pick_ronde_orders_pkey/.test(
    String(err?.message)
  );
}
check("twee orders in dezelfde bak wordt geweigerd", dubbeleBakGeweigerd);

/* 2 — dezelfde order in een tweede ronde mag niet. */
const [ronde2] = await sql`
  INSERT INTO wms.pick_rondes (code) VALUES (${`ZZ-R-${RUN}-b`}) RETURNING id`;
let dubbeleRondeGeweigerd = false;
try {
  await sql`
    INSERT INTO wms.pick_ronde_orders (ronde_id, pick_order_id, bak)
    VALUES (${ronde2.id}, ${orders[0]}, 1)`;
} catch (err) {
  dubbeleRondeGeweigerd = /idx_ronde_order_uniek/.test(String(err?.message));
}
check("dezelfde order in twee rondes wordt geweigerd", dubbeleRondeGeweigerd);

/* 3 — de looplijst voegt samen tot stops per (vak × sku). */
const stops = await sql`
  SELECT location_code, sku, count(*)::int AS bakken, sum(gevraagd)::int AS totaal,
         min(sort_order) AS volgorde
    FROM wms.ronde_stops
   WHERE ronde_id = ${ronde.id}
   GROUP BY location_code, sku
   ORDER BY min(sort_order), location_code`;

check(
  "drie orders, zes regels worden twee stops",
  stops.length === 2,
  `${stops.length} stops`
);

const stopA = stops.find((s) => s.sku === SKU_A);
const stopB = stops.find((s) => s.sku === SKU_B);
check(
  "stop voor SKU_A bundelt twee bakken tot 5 stuks",
  stopA && Number(stopA.bakken) === 2 && Number(stopA.totaal) === 5,
  stopA ? `${stopA.bakken} bakken, ${stopA.totaal} stuks` : "geen stop"
);
check(
  "stop voor SKU_B bundelt twee bakken tot 5 stuks",
  stopB && Number(stopB.bakken) === 2 && Number(stopB.totaal) === 5,
  stopB ? `${stopB.bakken} bakken, ${stopB.totaal} stuks` : "geen stop"
);

/* 4 — vakvolgorde, niet ordervolgorde. Z1 (9100) hoort vóór A1 (9200). */
check(
  "stops staan op looproute, niet op ordervolgorde",
  stops[0]?.location_code === "ZZ-TEST-Z1" && stops[1]?.location_code === "ZZ-TEST-A1",
  `${stops.map((s) => s.location_code).join(" → ")}`
);

/* Opruimen. Rondes en opdrachten mogen weg; het grootboek blijft. */
await sql`DELETE FROM wms.pick_rondes WHERE code LIKE ${`ZZ-R-${RUN}%`}`;
await sql`DELETE FROM wms.pick_orders WHERE bron_ref LIKE ${`${RUN}-%`}`;
await sql`DELETE FROM wms.stock_levels WHERE sku IN (${SKU_A}, ${SKU_B})`;
await sql`UPDATE wms.locations SET active = false WHERE code LIKE 'ZZ-TEST-%'`;

console.log(`\n${mislukt === 0 ? "Alles in orde." : `${mislukt} test(s) mislukt.`}`);
process.exit(mislukt === 0 ? 0 : 1);
