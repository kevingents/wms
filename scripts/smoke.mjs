/**
 * Smoke-test op de voorraad-invarianten. Draait tegen de echte database, maar
 * uitsluitend op locaties met prefix `ZZ-TEST-` en ruimt zichzelf op.
 *
 * Wat hier getest wordt is precies wat een WMS onbruikbaar maakt als het stuk is:
 *   1. een boeking werkt de saldi bij (trigger);
 *   2. je kunt niet meer wegnemen dan er ligt (harde CHECK, geen negatieve rest);
 *   3. een retry boekt niet dubbel (idempotency);
 *   4. het grootboek is onveranderlijk (append-only).
 *
 *   node scripts/smoke.mjs
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
const SKU = "ZZ-TEST-SKU";

/* Eigen kenmerk per run: het grootboek is append-only, dus sleutels van een
   vorige run blijven bestaan. Met een vaste sleutel botst de eerste boeking van
   de tweede run al, en dat is een testfout, geen systeemfout. */
const RUN = `zz-${Date.now().toString(36)}`;

let mislukt = 0;

function check(naam, geslaagd, detail = "") {
  console.log(`  ${geslaagd ? "ok  " : "FOUT"} ${naam}${detail ? ` — ${detail}` : ""}`);
  if (!geslaagd) mislukt += 1;
}

/**
 * Opruimen. De saldi kunnen weg, de testlocaties worden inactief gezet in plaats
 * van verwijderd — ze staan in het grootboek en dat is append-only, dus
 * verwijderen zou de historie onleesbaar maken. Precies zoals een echte locatie
 * die uit gebruik gaat: `active = false`, nooit DELETE.
 */
async function opruimen() {
  await sql`DELETE FROM wms.stock_levels WHERE sku = ${SKU}`;
  await sql`UPDATE wms.locations SET active = false WHERE code LIKE 'ZZ-TEST-%'`;
}

async function saldo(locId) {
  const r = await sql`
    SELECT qty FROM wms.stock_levels WHERE sku = ${SKU} AND location_id = ${locId}`;
  return r[0] ? Number(r[0].qty) : 0;
}

console.log("Smoke-test voorraad-invarianten\n");

/* Oude saldi weg; de locaties hergebruiken we zodat herhaald draaien niets
   ophoopt (upsert op de unieke code). */
await sql`DELETE FROM wms.stock_levels WHERE sku = ${SKU}`;

const [locA] = await sql`
  INSERT INTO wms.locations (code, name, zone, kind, sort_order)
  VALUES ('ZZ-TEST-A', 'Testlocatie A', 'TEST', 'pick', 9000)
  ON CONFLICT (code) DO UPDATE SET active = true RETURNING id`;
const [locB] = await sql`
  INSERT INTO wms.locations (code, name, zone, kind, sort_order)
  VALUES ('ZZ-TEST-B', 'Testlocatie B', 'TEST', 'bulk', 9001)
  ON CONFLICT (code) DO UPDATE SET active = true RETURNING id`;

const A = locA.id;
const B = locB.id;

/* 1 — instroom werkt de saldi bij */
await sql`
  INSERT INTO wms.stock_moves (sku, to_location_id, qty, reason, actor_name)
  VALUES (${SKU}, ${A}, 10, 'ontvangst', 'smoke')`;
check("ontvangst 10 op A boekt saldo", (await saldo(A)) === 10, `A=${await saldo(A)}`);

/* 2 — verplaatsing haalt van de ene af en zet op de andere */
await sql`
  INSERT INTO wms.stock_moves (sku, from_location_id, to_location_id, qty, reason, actor_name)
  VALUES (${SKU}, ${A}, ${B}, 4, 'verplaatsing', 'smoke')`;
check(
  "verplaatsing 4 van A naar B",
  (await saldo(A)) === 6 && (await saldo(B)) === 4,
  `A=${await saldo(A)} B=${await saldo(B)}`
);

/* 3 — je kunt niet meer wegnemen dan er ligt */
let geweigerd = false;
try {
  await sql`
    INSERT INTO wms.stock_moves (sku, from_location_id, qty, reason, actor_name)
    VALUES (${SKU}, ${A}, 7, 'pick', 'smoke')`;
} catch (err) {
  geweigerd = /levels_niet_negatief/.test(String(err?.message));
}
check("pick van 7 uit een locatie met 6 wordt geweigerd", geweigerd);
check("saldo A ongewijzigd na geweigerde pick", (await saldo(A)) === 6, `A=${await saldo(A)}`);

/* 4 — retry met dezelfde idempotency-sleutel boekt niet dubbel */
const sleutel = `${RUN}-idem-1`;
await sql`
  INSERT INTO wms.stock_moves (sku, from_location_id, qty, reason, actor_name, idempotency_key)
  VALUES (${SKU}, ${A}, 2, 'pick', 'smoke', ${sleutel})`;
let dubbelGeweigerd = false;
try {
  await sql`
    INSERT INTO wms.stock_moves (sku, from_location_id, qty, reason, actor_name, idempotency_key)
    VALUES (${SKU}, ${A}, 2, 'pick', 'smoke', ${sleutel})`;
} catch (err) {
  dubbelGeweigerd = String(err?.code) === "23505" || /idempotency/.test(String(err?.message));
}
check("tweede boeking met dezelfde sleutel wordt geweigerd", dubbelGeweigerd);
check("saldo A is 4 na één pick van 2", (await saldo(A)) === 4, `A=${await saldo(A)}`);

/* 5 — het grootboek is onveranderlijk */
let updateGeweigerd = false;
try {
  await sql`UPDATE wms.stock_moves SET qty = 99 WHERE sku = ${SKU}`;
} catch (err) {
  updateGeweigerd = /append-only/.test(String(err?.message));
}
check("UPDATE op stock_moves wordt geweigerd", updateGeweigerd);

let deleteGeweigerd = false;
try {
  await sql`DELETE FROM wms.stock_moves WHERE sku = ${SKU}`;
} catch (err) {
  deleteGeweigerd = /append-only/.test(String(err?.message));
}
check("DELETE op stock_moves wordt geweigerd", deleteGeweigerd);

/* 6 — van/naar dezelfde locatie is onzin en wordt geblokkeerd */
let zelfdeGeweigerd = false;
try {
  await sql`
    INSERT INTO wms.stock_moves (sku, from_location_id, to_location_id, qty, reason)
    VALUES (${SKU}, ${A}, ${A}, 1, 'verplaatsing')`;
} catch (err) {
  zelfdeGeweigerd = /moves_niet_zelfde/.test(String(err?.message));
}
check("verplaatsing naar dezelfde locatie wordt geweigerd", zelfdeGeweigerd);

/* 7 — de shadow-view draait en levert een verschil op voor de test-sku */
const shadow = await sql`SELECT * FROM wms.shadow_verschil WHERE sku = ${SKU}`;
check(
  "shadow_verschil toont de test-sku als WMS-overschot",
  shadow.length === 1 && Number(shadow[0].diff) === 8,
  shadow.length ? `diff=${shadow[0].diff}` : "geen rij"
);

await opruimen();
console.log(
  `\n${mislukt === 0 ? "Alles in orde." : `${mislukt} test(s) mislukt.`}` +
    "\nTestboekingen blijven in het grootboek staan onder sku ZZ-TEST-SKU (append-only)."
);
process.exit(mislukt === 0 ? 0 : 1);
