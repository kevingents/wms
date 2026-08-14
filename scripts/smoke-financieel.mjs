/**
 * Smoke-test op de financiële invarianten.
 *
 * Dit is de test die bepaalt of het WMS mee mag tellen in de jaarrekening:
 *   1. instroom waardeert tegen de inkoopprijs;
 *   2. het voortschrijdend gemiddelde klopt na een tweede ontvangst met een
 *      andere prijs;
 *   3. uitstroom boekt af tegen dat gemiddelde (= kostprijs verkopen);
 *   4. een interne verplaatsing verandert de waarde niet;
 *   5. waarde in − waarde uit = waarde op voorraad (de sluitcontrole);
 *   6. het grootboek is in balans: debet = credit;
 *   7. een afgesloten periode weigert nieuwe boekingen.
 *
 *   node scripts/smoke-financieel.mjs
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

/* Eigen artikel per run. Het grootboek is append-only, dus boekingen van een
   vorige run blijven staan; met een vaste sku zou de sluitcontrole de historie
   van alle runs bij elkaar optellen en terecht een verschil melden. */
const SKU = `ZZ-TEST-FIN-${Date.now().toString(36)}`;
let mislukt = 0;

function check(naam, geslaagd, detail = "") {
  console.log(`  ${geslaagd ? "ok  " : "FOUT"} ${naam}${detail ? ` — ${detail}` : ""}`);
  if (!geslaagd) mislukt += 1;
}

async function waarde() {
  const r = await sql`SELECT * FROM wms.artikel_waarde WHERE sku = ${SKU}`;
  return r[0] ?? { aantal: 0, waarde_cent: 0, gem_kostprijs_cent: 0 };
}

console.log("Smoke-test financiële invarianten\n");

/* Nieuw artikel per run, dus er valt niets op te ruimen vooraf. */

const [vakA] = await sql`
  INSERT INTO wms.locations (code, name, zone, kind, sort_order, pickable)
  VALUES ('ZZ-FIN-A', 'Fin A', 'TEST', 'pick', 9600, true)
  ON CONFLICT (code) DO UPDATE SET active = true RETURNING id`;
const [vakB] = await sql`
  INSERT INTO wms.locations (code, name, zone, kind, sort_order, pickable)
  VALUES ('ZZ-FIN-B', 'Fin B', 'TEST', 'bulk', 9601, true)
  ON CONFLICT (code) DO UPDATE SET active = true RETURNING id`;

/* Rekeningschema: als er nog geen is ingesteld zetten we er zelf een, zodat de
   journaalposten ook echt getest worden. Aan het eind zetten we het terug —
   anders zou de test de productie-instellingen wijzigen. */
const bestaandeGl = Object.fromEntries(
  (
    await sql`
      SELECT key, trim(both '"' FROM value::text) AS waarde FROM wms.settings
       WHERE key LIKE 'financieel.gl_%'`
  ).map((r) => [r.key, r.waarde])
);
const glZelfGezet = !bestaandeGl["financieel.gl_voorraad"];

if (glZelfGezet) {
  for (const [key, waarde] of [
    ["financieel.gl_voorraad", "3000"],
    ["financieel.gl_te_ontvangen", "1600"],
    ["financieel.gl_kostprijs_verkopen", "7000"],
    ["financieel.gl_voorraadverschil", "7090"],
  ]) {
    await sql`
      INSERT INTO wms.settings (key, value, updated_by)
      VALUES (${key}, ${JSON.stringify(waarde)}::jsonb, 'smoke-fin')
      ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
  }
}

/* ── 1. Instroom tegen inkoopprijs ───────────────────────────────────────── */
await sql`
  INSERT INTO wms.kostprijzen (sku, kostprijs_cent, bron) VALUES (${SKU}, 1000, 'handmatig')`;
await sql`
  INSERT INTO wms.stock_moves (sku, to_location_id, qty, reason, actor_name)
  VALUES (${SKU}, ${vakA.id}, 10, 'ontvangst', 'smoke-fin')`;

let w = await waarde();
check(
  "10 stuks à €10,00 geeft een voorraadwaarde van €100,00",
  Number(w.aantal) === 10 && Number(w.waarde_cent) === 10000 && Number(w.gem_kostprijs_cent) === 1000,
  `${w.aantal} st, ${w.waarde_cent} cent, gem ${w.gem_kostprijs_cent}`
);

/* ── 2. Voortschrijdend gemiddelde na een duurdere ontvangst ─────────────── */
await sql`
  INSERT INTO wms.kostprijzen (sku, kostprijs_cent, bron) VALUES (${SKU}, 2000, 'handmatig')`;
await sql`
  INSERT INTO wms.stock_moves (sku, to_location_id, qty, reason, actor_name)
  VALUES (${SKU}, ${vakA.id}, 10, 'ontvangst', 'smoke-fin')`;

w = await waarde();
check(
  "10 à €10 plus 10 à €20 geeft gemiddeld €15,00",
  Number(w.aantal) === 20 && Number(w.waarde_cent) === 30000 && Number(w.gem_kostprijs_cent) === 1500,
  `${w.aantal} st, €${(w.waarde_cent / 100).toFixed(2)}, gem €${(w.gem_kostprijs_cent / 100).toFixed(2)}`
);

/* ── 3. Interne verplaatsing raakt de waarde niet ────────────────────────── */
await sql`
  INSERT INTO wms.stock_moves (sku, from_location_id, to_location_id, qty, reason, actor_name)
  VALUES (${SKU}, ${vakA.id}, ${vakB.id}, 5, 'verplaatsing', 'smoke-fin')`;

w = await waarde();
check(
  "verplaatsen tussen vakken verandert de waarde niet",
  Number(w.aantal) === 20 && Number(w.waarde_cent) === 30000,
  `${w.aantal} st, €${(w.waarde_cent / 100).toFixed(2)}`
);

const [intern] = await sql`
  SELECT waarde_cent FROM wms.stock_moves
   WHERE sku = ${SKU} AND reason = 'verplaatsing' ORDER BY id DESC LIMIT 1`;
check("interne mutatie heeft waarde 0", Number(intern.waarde_cent) === 0);

/* ── 4. Uitstroom tegen het gemiddelde ───────────────────────────────────── */
await sql`
  INSERT INTO wms.stock_moves (sku, from_location_id, qty, reason, actor_name)
  VALUES (${SKU}, ${vakA.id}, 4, 'verzonden', 'smoke-fin')`;

w = await waarde();
const [uit] = await sql`
  SELECT waarde_cent, kostprijs_cent FROM wms.stock_moves
   WHERE sku = ${SKU} AND reason = 'verzonden' ORDER BY id DESC LIMIT 1`;
check(
  "4 stuks uit boekt €60,00 af tegen het gemiddelde van €15",
  Number(uit.waarde_cent) === 6000 && Number(uit.kostprijs_cent) === 1500,
  `€${(uit.waarde_cent / 100).toFixed(2)} tegen €${(uit.kostprijs_cent / 100).toFixed(2)}`
);
check(
  "resterende waarde is €240,00 over 16 stuks",
  Number(w.aantal) === 16 && Number(w.waarde_cent) === 24000,
  `${w.aantal} st, €${(w.waarde_cent / 100).toFixed(2)}`
);

/* ── 5. Sluitcontrole voor dit artikel ───────────────────────────────────── */
const [sluit] = await sql`
  SELECT
    coalesce(sum(waarde_cent) FILTER (WHERE from_location_id IS NULL), 0)::bigint AS in_cent,
    coalesce(sum(waarde_cent) FILTER (WHERE to_location_id IS NULL), 0)::bigint   AS uit_cent
  FROM wms.stock_moves WHERE sku = ${SKU}`;
check(
  "waarde in − waarde uit = waarde op voorraad",
  Number(sluit.in_cent) - Number(sluit.uit_cent) === Number(w.waarde_cent),
  `${sluit.in_cent} − ${sluit.uit_cent} = ${w.waarde_cent}`
);

/* ── 6. Grootboek ────────────────────────────────────────────────────────── */
const [gb] = await sql`
  SELECT coalesce(sum(g.debet_cent), 0)::bigint AS debet,
         coalesce(sum(g.credit_cent), 0)::bigint AS credit
    FROM wms.grootboek_regels g
    JOIN wms.stock_moves m ON m.id = g.move_id
   WHERE m.sku = ${SKU}`;
check(
  "grootboek in balans: debet = credit",
  Number(gb.debet) === Number(gb.credit) && Number(gb.debet) > 0,
  `debet ${gb.debet}, credit ${gb.credit}`
);

/* De ontvangst hoort voorraad te debiteren en 'nog te ontvangen' te crediteren;
   de uitgifte precies andersom met de kostprijsrekening. */
const posten = await sql`
  SELECT g.soort, g.grootboek, g.debet_cent, g.credit_cent
    FROM wms.grootboek_regels g
    JOIN wms.stock_moves m ON m.id = g.move_id
   WHERE m.sku = ${SKU}
   ORDER BY g.id`;
const ontvangstDebet = posten.find(
  (p) => p.soort === "ontvangst" && Number(p.debet_cent) > 0
);
const uitgifteDebet = posten.find(
  (p) => p.soort === "uitgifte" && Number(p.debet_cent) > 0
);
check(
  "ontvangst debiteert de voorraadrekening",
  ontvangstDebet?.grootboek === (bestaandeGl["financieel.gl_voorraad"] || "3000"),
  ontvangstDebet?.grootboek ?? "geen post"
);
check(
  "uitgifte debiteert de kostprijsrekening, niet de voorraad",
  uitgifteDebet?.grootboek ===
    (bestaandeGl["financieel.gl_kostprijs_verkopen"] || "7000"),
  uitgifteDebet?.grootboek ?? "geen post"
);
check(
  "een interne verplaatsing levert geen journaalpost op",
  !posten.some((p) => p.soort === "verplaatsing")
);

/* ── 7. Afgesloten periode weigert boekingen ─────────────────────────────── */
const nu = new Date();
const jaar = nu.getUTCFullYear();
const maand = nu.getUTCMonth() + 1;

await sql`
  INSERT INTO wms.perioden (jaar, maand, status, afgesloten_door, afgesloten_at)
  VALUES (${jaar}, ${maand}, 'afgesloten', 'smoke', now())
  ON CONFLICT (jaar, maand) DO UPDATE SET status = 'afgesloten'`;

let geweigerd = false;
try {
  await sql`
    INSERT INTO wms.stock_moves (sku, to_location_id, qty, reason, actor_name)
    VALUES (${SKU}, ${vakA.id}, 1, 'ontvangst', 'smoke-fin')`;
} catch (err) {
  geweigerd = /afgesloten/.test(String(err?.message));
}
check("boeken in een afgesloten periode wordt geweigerd", geweigerd);

/* Periode weer open, anders blokkeert dit de echte werking. */
await sql`DELETE FROM wms.perioden WHERE jaar = ${jaar} AND maand = ${maand}`;

let weerMogelijk = false;
try {
  await sql`
    INSERT INTO wms.stock_moves (sku, from_location_id, qty, reason, actor_name)
    VALUES (${SKU}, ${vakA.id}, 1, 'afschrijving', 'smoke-fin')`;
  weerMogelijk = true;
} catch {
  weerMogelijk = false;
}
check("na heropenen kan er weer geboekt worden", weerMogelijk);

/* Opruimen: waardering en saldi weg, grootboek en ledger blijven. */
await sql`DELETE FROM wms.artikel_waarde WHERE sku = ${SKU}`;
await sql`DELETE FROM wms.stock_levels WHERE sku = ${SKU}`;
await sql`DELETE FROM wms.kostprijzen WHERE sku = ${SKU}`;
await sql`UPDATE wms.locations SET active = false WHERE code LIKE 'ZZ-FIN-%'`;

/* Rekeningschema terugzetten zoals het was. */
if (glZelfGezet) {
  await sql`DELETE FROM wms.settings WHERE key LIKE 'financieel.gl_%' AND updated_by = 'smoke-fin'`;
}

console.log(
  `\n${mislukt === 0 ? "Alles in orde — de waardering sluit." : `${mislukt} test(s) mislukt.`}`
);
process.exit(mislukt === 0 ? 0 : 1);
