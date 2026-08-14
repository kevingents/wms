/**
 * Smoke-test op de pick-invarianten. Draait tegen de echte database, uitsluitend
 * op locaties met prefix `ZZ-TEST-` en sku `ZZ-TEST-SKU`, en ruimt zichzelf op.
 *
 * Wat hier getest wordt is wat picking onbetrouwbaar maakt als het stuk is:
 *   1. vrije voorraad trekt af wat al aan open picks is toegezegd — anders
 *      stuur je twee pickers naar dezelfde vier stuks;
 *   2. een gepikte regel kan niet méér zijn dan gevraagd;
 *   3. de import is idempotent (UNIQUE op bron + bron_ref);
 *   4. picken boekt van de piklocatie naar expeditie, niet het pand uit.
 *
 *   node scripts/smoke-picken.mjs
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

/* Eigen kenmerk per run: het grootboek is append-only, dus boekingen van een
   vorige run blijven staan. Zonder dit botst de idempotency-sleutel de tweede
   keer dat je de test draait. */
const RUN = `ZZ-TEST-${Date.now().toString(36)}`;

let mislukt = 0;

function check(naam, geslaagd, detail = "") {
  console.log(`  ${geslaagd ? "ok  " : "FOUT"} ${naam}${detail ? ` — ${detail}` : ""}`);
  if (!geslaagd) mislukt += 1;
}

console.log("Smoke-test pick-invarianten\n");

/* Schone start. Pickopdrachten mogen weg (geen grootboek); saldi ook. */
await sql`DELETE FROM wms.pick_orders WHERE bron_ref LIKE 'ZZ-TEST%'`;
await sql`DELETE FROM wms.stock_levels WHERE sku = ${SKU}`;

const [locA] = await sql`
  INSERT INTO wms.locations (code, name, zone, kind, sort_order, pickable)
  VALUES ('ZZ-TEST-A', 'Testlocatie A', 'TEST', 'pick', 9000, true)
  ON CONFLICT (code) DO UPDATE SET active = true, kind = 'pick', pickable = true
  RETURNING id`;
const [expeditie] = await sql`SELECT id FROM wms.locations WHERE code = 'EXPEDITIE'`;

check("expeditielocatie bestaat", Boolean(expeditie), expeditie ? "" : "EXPEDITIE ontbreekt");
if (!expeditie) process.exit(1);

const A = locA.id;
const EXP = expeditie.id;

/* Beginvoorraad: 10 stuks op A. */
await sql`
  INSERT INTO wms.stock_moves (sku, to_location_id, qty, reason, actor_name)
  VALUES (${SKU}, ${A}, 10, 'ontvangst', 'smoke-picken')`;

async function vrij() {
  const r = await sql`
    SELECT aanwezig, toegewezen, vrij FROM wms.vrije_voorraad
     WHERE sku = ${SKU} AND location_id = ${A}`;
  return r[0] ?? { aanwezig: 0, toegewezen: 0, vrij: 0 };
}

check("vrije voorraad is 10 zonder open picks", Number((await vrij()).vrij) === 10);

/* Pickopdracht 1: 6 stuks toegewezen aan A. */
const [order1] = await sql`
  INSERT INTO wms.pick_orders (code, bron, bron_ref, bestemming)
  VALUES (${`ZZ-P-1-${RUN}`}, 'handmatig', ${`${RUN}-1`}, 'Test') RETURNING id`;
const [regel1] = await sql`
  INSERT INTO wms.pick_lines (pick_order_id, sku, gevraagd, location_id, volgorde)
  VALUES (${order1.id}, ${SKU}, 6, ${A}, 9000) RETURNING id`;

const na1 = await vrij();
check(
  "toewijzing van 6 verlaagt de vrije voorraad naar 4",
  Number(na1.toegewezen) === 6 && Number(na1.vrij) === 4,
  `aanwezig=${na1.aanwezig} toegewezen=${na1.toegewezen} vrij=${na1.vrij}`
);
check("aanwezige voorraad is ongewijzigd door toewijzing", Number(na1.aanwezig) === 10);

/* Meer picken dan gevraagd mag niet. */
let teVeelGeweigerd = false;
try {
  await sql`UPDATE wms.pick_lines SET gepikt = 7 WHERE id = ${regel1.id}`;
} catch (err) {
  teVeelGeweigerd = /pick_lines_gepikt_chk/.test(String(err?.message));
}
check("meer picken dan gevraagd wordt geweigerd", teVeelGeweigerd);

/* Import-idempotentie: dezelfde bron + referentie levert geen tweede opdracht. */
const dubbel = await sql`
  INSERT INTO wms.pick_orders (code, bron, bron_ref, bestemming)
  VALUES (${`ZZ-P-1b-${RUN}`}, 'handmatig', ${`${RUN}-1`}, 'Test')
  ON CONFLICT (bron, bron_ref) DO NOTHING RETURNING id`;
check("tweede import van dezelfde bron levert geen opdracht", dubbel.length === 0);

/* Picken: van A naar expeditie. */
await sql`
  INSERT INTO wms.stock_moves
    (sku, from_location_id, to_location_id, qty, reason, ref_type, ref_id, actor_name)
  VALUES (${SKU}, ${A}, ${EXP}, 6, 'pick', 'pickopdracht', ${`ZZ-P-1-${RUN}`}, 'smoke-picken')`;
await sql`
  UPDATE wms.pick_lines SET gepikt = 6, status = 'gepikt', afgerond_at = now()
   WHERE id = ${regel1.id}`;

const [saldoA] = await sql`
  SELECT qty FROM wms.stock_levels WHERE sku = ${SKU} AND location_id = ${A}`;
const [saldoExp] = await sql`
  SELECT qty FROM wms.stock_levels WHERE sku = ${SKU} AND location_id = ${EXP}`;
check(
  "picken haalt van de piklocatie en zet op expeditie",
  Number(saldoA?.qty) === 4 && Number(saldoExp?.qty) === 6,
  `A=${saldoA?.qty} EXPEDITIE=${saldoExp?.qty}`
);

const na2 = await vrij();
check(
  "afgeronde regel telt niet meer als toegewezen",
  Number(na2.toegewezen) === 0 && Number(na2.vrij) === 4,
  `toegewezen=${na2.toegewezen} vrij=${na2.vrij}`
);

/* Verzenden: van expeditie het pand uit. */
await sql`
  INSERT INTO wms.stock_moves
    (sku, from_location_id, qty, reason, ref_type, ref_id, actor_name, idempotency_key)
  VALUES (${SKU}, ${EXP}, 6, 'verzonden', 'pickopdracht', 'ZZ-P-1', 'smoke-picken',
          ${`${RUN}-verzend`})`;
const [naVerzending] = await sql`
  SELECT qty FROM wms.stock_levels WHERE sku = ${SKU} AND location_id = ${EXP}`;
check("verzenden maakt expeditie leeg", Number(naVerzending?.qty ?? 0) === 0);

/* Dubbel verzenden mag niet — dezelfde idempotency-sleutel. */
let dubbelVerzendGeweigerd = false;
try {
  await sql`
    INSERT INTO wms.stock_moves
      (sku, from_location_id, qty, reason, actor_name, idempotency_key)
    VALUES (${SKU}, ${EXP}, 6, 'verzonden', 'smoke-picken', ${`${RUN}-verzend`})`;
} catch (err) {
  dubbelVerzendGeweigerd = String(err?.code) === "23505";
}
check("tweede verzendboeking met dezelfde sleutel wordt geweigerd", dubbelVerzendGeweigerd);

/* ── Koppeling met de portal ──────────────────────────────────────────────── */

/* Elk rekenmodel uit de portal moet door dezelfde deur passen. */
let bronnenOk = true;
for (const bron of ["herverdeling", "forecast", "aanvulling", "inkoop"]) {
  try {
    await sql`
      INSERT INTO wms.pick_orders (code, bron, bron_ref, bestemming)
      VALUES (${`ZZ-P-${bron}-${RUN}`}, ${bron}, ${`${RUN}-${bron}`}, 'Test')`;
  } catch {
    bronnenOk = false;
  }
}
check("portal-bronnen (herverdeling/forecast/aanvulling/inkoop) toegestaan", bronnenOk);

let onzinGeweigerd = false;
try {
  await sql`
    INSERT INTO wms.pick_orders (code, bron, bron_ref)
    VALUES (${`ZZ-P-onzin-${RUN}`}, 'onzin', ${`${RUN}-onzin`})`;
} catch (err) {
  onzinGeweigerd = /pick_orders_bron_chk/.test(String(err?.message));
}
check("onbekende bron wordt geweigerd", onzinGeweigerd);

/* Terugmelding zonder callback wordt bewaard maar niet verstuurd — het spoor
   blijft compleet, ook als de portal niets terug wil. */
const [metCallback] = await sql`
  SELECT id FROM wms.pick_orders WHERE bron_ref = ${`${RUN}-herverdeling`}`;
await sql`
  INSERT INTO wms.koppeling_uitgaand (soort, pick_order_id, doel_url, payload, status)
  VALUES ('verzonden', ${metCallback.id}, NULL, '{"test":true}'::jsonb, 'overgeslagen')`;
const [zonderDoel] = await sql`
  SELECT count(*)::int AS n FROM wms.koppeling_uitgaand
   WHERE pick_order_id = ${metCallback.id} AND status = 'overgeslagen'`;
check("terugmelding zonder callback wordt bewaard, niet verstuurd", zonderDoel.n === 1);

let onzinStatusGeweigerd = false;
try {
  await sql`
    INSERT INTO wms.koppeling_uitgaand (soort, payload, status)
    VALUES ('verzonden', '{}'::jsonb, 'zomaarwat')`;
} catch (err) {
  onzinStatusGeweigerd = /koppeling_status_chk/.test(String(err?.message));
}
check("onbekende koppelingsstatus wordt geweigerd", onzinStatusGeweigerd);

await sql`DELETE FROM wms.koppeling_uitgaand WHERE payload::text LIKE '%"test":true%'`;

/* Opruimen: opdrachten weg, saldi weg, testlocatie inactief. Het grootboek
   blijft — dat is append-only en dat is precies de bedoeling. */
await sql`DELETE FROM wms.pick_orders WHERE bron_ref LIKE 'ZZ-TEST%'`;
await sql`DELETE FROM wms.stock_levels WHERE sku = ${SKU}`;
await sql`UPDATE wms.locations SET active = false WHERE code LIKE 'ZZ-TEST-%'`;

console.log(`\n${mislukt === 0 ? "Alles in orde." : `${mislukt} test(s) mislukt.`}`);
process.exit(mislukt === 0 ? 0 : 1);
