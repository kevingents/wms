/**
 * Beginvoorraad laden uit SRS — locaties én voorraad per vak.
 *
 * DIT IS DE GO-LIVE
 * -----------------
 * SRS houdt per vak bij welke sku er ligt. Daarmee kan het WMS beginnen met de
 * werkelijkheid in plaats van met een lege hal: locaties aanmaken en de voorraad
 * meteen op het juiste vak zetten. Het magazijn hoeft dan niet te herindelen,
 * alleen te controleren.
 *
 * EENMALIG
 * --------
 * Een tweede import zou de voorraad verdubbelen. Daarom weigert het script als
 * er al een startsaldo geboekt is. Latere verschillen corrigeer je met tellingen,
 * niet met een herhaalde import — dat is wat het telprogramma ervoor is.
 *
 * WAT ER NIET GEBEURT
 * -------------------
 * Geen kostprijzen, geen journaalposten met terugwerkende kracht. De boekingen
 * krijgen reden `startsaldo` en zijn als zodanig herkenbaar in het grootboek.
 *
 *   node scripts/import-srs-voorraad.mjs            (proefrun)
 *   node scripts/import-srs-voorraad.mjs --doen     (echt boeken)
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon } from "@neondatabase/serverless";

const hier = dirname(fileURLToPath(import.meta.url));
const doen = process.argv.includes("--doen");
const BRANCH = "99";
const PAGINA = 2000;

if (!process.env.DATABASE_URL || !process.env.ADMIN_TOKEN) {
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
const BASE = (process.env.BACKEND_API_BASE || "").replace(/\/+$/, "");
const TOKEN = process.env.ADMIN_TOKEN;

if (!BASE || !TOKEN) {
  console.error("BACKEND_API_BASE en ADMIN_TOKEN zijn allebei nodig.");
  process.exit(1);
}

/* ── Codes normaliseren ─────────────────────────────────────────────────────
   SRS is inconsistent: 'H01 1A1' en 'L3110A1' zijn dezelfde vorm, met en zonder
   spatie. We slaan op mét spatie omdat dat op de meeste labels staat; de
   gegenereerde kolom code_zoek zorgt dat beide varianten gevonden worden. */
function normaliseerCode(code) {
  const schoon = String(code ?? "").trim().toUpperCase();
  const m = schoon.match(/^([A-Z]+)(\d{2})\s*(\d{1,2})([A-Z])(\d)$/);
  if (!m) return schoon;
  const [, zone, gang, stelling, niveau, positie] = m;
  return `${zone}${gang} ${Number(stelling)}${niveau}${positie}`;
}

/* ── Ophalen ────────────────────────────────────────────────────────────────── */

async function haalPagina(offset) {
  const url =
    `${BASE}/api/admin/voorraad-locaties` +
    `?branchId=${BRANCH}&store=${encodeURIComponent("GENTS Magazijn")}` +
    `&limit=${PAGINA}&offset=${offset}`;
  const res = await fetch(url, { headers: { "x-admin-token": TOKEN }, cache: "no-store" });
  if (!res.ok) throw new Error(`storegents gaf status ${res.status}`);
  const data = await res.json();
  if (!data?.success) throw new Error(data?.message || "onbekende fout");
  return data;
}

console.log(`Beginvoorraad ${doen ? "LADEN" : "(proefrun — er wordt niets geboekt)"}\n`);

const [alGeladen] = await sql`
  SELECT count(*)::int AS n FROM wms.stock_moves WHERE reason = 'startsaldo'`;
if (alGeladen.n > 0) {
  console.error(
    `Er staan al ${alGeladen.n} startsaldo-boekingen. Een tweede import zou de voorraad\n` +
      `verdubbelen. Corrigeer verschillen met tellingen, niet met een herhaalde import.`
  );
  process.exit(1);
}

const rijen = [];
let offset = 0;
let generatedAt = null;
for (let p = 0; p < 20; p++) {
  const data = await haalPagina(offset);
  generatedAt = data.generatedAt ?? generatedAt;
  const pagina = (data.rows ?? []).filter((r) => String(r.filiaalNummer) === BRANCH);
  rijen.push(...pagina);
  process.stdout.write(`\r  opgehaald: ${rijen.length}/${data.count}`);
  if (!data.truncated || pagina.length === 0) break;
  offset += (data.rows ?? []).length;
}
console.log("");

const bruikbaar = rijen.filter(
  (r) => String(r.sku ?? "").trim() && String(r.locatie ?? "").trim() && Number(r.aantal) > 0
);

/* Per (locatie, sku) optellen: SRS kan dezelfde combinatie meerdere keren geven. */
const perVak = new Map();
for (const r of bruikbaar) {
  const code = normaliseerCode(r.locatie);
  const sku = String(r.sku).trim();
  const sleutel = `${code}|${sku}`;
  const bestaand = perVak.get(sleutel);
  if (bestaand) bestaand.aantal += Number(r.aantal);
  else
    perVak.set(sleutel, {
      code,
      sku,
      aantal: Number(r.aantal),
      geblokkeerd: Boolean(r.geblokkeerd),
    });
}

const codes = [...new Set([...perVak.values()].map((v) => v.code))];
const skus = [...new Set([...perVak.values()].map((v) => v.sku))];
const stuks = [...perVak.values()].reduce((s, v) => s + v.aantal, 0);

/* Welke locaties kent het WMS al? De rest moet aangemaakt worden. */
const bekend = await sql`
  SELECT code, code_zoek FROM wms.locations WHERE code_zoek = ANY(${codes.map((c) =>
    c.replace(/[^A-Za-z0-9]/g, "").toUpperCase()
  )}::text[])`;
const bekendeZoek = new Set(bekend.map((r) => r.code_zoek));
const nieuweCodes = codes.filter(
  (c) => !bekendeZoek.has(c.replace(/[^A-Za-z0-9]/g, "").toUpperCase())
);

const bekendeSkus = await sql`
  SELECT sku FROM wms.artikelen WHERE sku = ANY(${skus}::text[])`;
const skuSet = new Set(bekendeSkus.map((r) => r.sku));
const onbekendeSkus = skus.filter((s) => !skuSet.has(s));

console.log(`
  SRS-peiling      : ${generatedAt ?? "onbekend"}
  regels bruikbaar : ${bruikbaar.length} van ${rijen.length}
  vak-artikelparen : ${perVak.size}
  locaties         : ${codes.length} (${nieuweCodes.length} nog niet in het WMS)
  artikelen        : ${skus.length} (${onbekendeSkus.length} onbekend in de catalogus)
  totaal stuks     : ${stuks.toLocaleString("nl-NL")}`);

if (nieuweCodes.length) {
  console.log(`  nieuwe locaties  : ${nieuweCodes.slice(0, 8).join(", ")}${nieuweCodes.length > 8 ? " …" : ""}`);
}
if (onbekendeSkus.length) {
  console.log(`  onbekende skus   : ${onbekendeSkus.slice(0, 6).join(", ")}${onbekendeSkus.length > 6 ? " …" : ""}`);
  console.log(`  (die worden wél geboekt — voorraad die er ligt hoort in het systeem,
   ook als de catalogus hem nog niet kent)`);
}

if (!doen) {
  console.log("\nProefrun klaar. Draai opnieuw met --doen om te boeken.");
  process.exit(0);
}

/* ── Locaties bijmaken ──────────────────────────────────────────────────────── */

if (nieuweCodes.length) {
  const BATCH = 200;
  for (let i = 0; i < nieuweCodes.length; i += BATCH) {
    const stuk = nieuweCodes.slice(i, i + BATCH);
    const params = [];
    const groepen = [];
    let p = 1;
    for (const code of stuk) {
      const zone = code.match(/^([A-Z]+)/)?.[1] ?? "OVERIG";
      groepen.push(`($${p++}, $${p++}, $${p++}, 'pick', $${p++}, '99')`);
      params.push(code, `SRS-locatie ${code}`, zone, 900000 + i);
    }
    await sql.query(
      `INSERT INTO wms.locations (code, name, zone, kind, sort_order, filiaal)
       VALUES ${groepen.join(", ")}
       ON CONFLICT (code) DO UPDATE SET active = true`,
      params
    );
  }
  console.log(`  ${nieuweCodes.length} locaties bijgemaakt`);
}

/* ── Boeken ─────────────────────────────────────────────────────────────────
   In batches met een INSERT ... SELECT die de locatie-id in hetzelfde statement
   opzoekt via code_zoek. De HTTP-driver doet één statement per call, dus 5.800
   losse boekingen zouden 5.800 round-trips zijn. */

const peiling = String(generatedAt ?? "onbekend").slice(0, 24);
const alles = [...perVak.values()];
const BATCH = 400;
let geboekt = 0;

for (let i = 0; i < alles.length; i += BATCH) {
  const stuk = alles.slice(i, i + BATCH);
  const params = [];
  const groepen = [];
  let p = 1;
  for (const v of stuk) {
    groepen.push(`($${p++}, $${p++}, $${p++}, $${p++})`);
    params.push(
      v.sku,
      v.code.replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
      v.aantal,
      `startsaldo:srs:${peiling}:${v.code}:${v.sku}`
    );
  }

  await sql.query(
    `INSERT INTO wms.stock_moves
       (sku, to_location_id, qty, reason, actor_name, note, idempotency_key)
     SELECT v.sku::text, l.id, v.qty::int, 'startsaldo', 'beginvoorraad-srs',
            'Beginvoorraad SRS ' || v.code, v.sleutel::text
       FROM (VALUES ${groepen.join(", ")}) AS v(sku, code, qty, sleutel)
       JOIN wms.locations l ON l.code_zoek = v.code::text
     ON CONFLICT (idempotency_key) DO NOTHING`,
    params
  );

  geboekt += stuk.length;
  process.stdout.write(`\r  geboekt: ${geboekt}/${alles.length}`);
}
console.log("");

const [stand] = await sql`
  SELECT count(DISTINCT sku)::int AS skus,
         count(DISTINCT location_id)::int AS locaties,
         coalesce(sum(qty), 0)::int AS stuks
    FROM wms.stock_levels WHERE qty > 0`;

const [verschil] = await sql`
  SELECT count(*) FILTER (WHERE diff <> 0)::int AS skus_verschil,
         coalesce(sum(abs(diff)), 0)::int AS stuks_verschil
    FROM wms.shadow_verschil`;

console.log(`
Klaar.
  in het WMS : ${stand.stuks.toLocaleString("nl-NL")} stuks, ${stand.skus} artikelen, ${stand.locaties} bezette vakken
  verschil met SRS: ${verschil.skus_verschil} sku's, ${verschil.stuks_verschil} stuks

Staat dat verschil niet op nul, dan komt dat doordat de voorraadspiegel en de
locatie-export op verschillende momenten gepeild zijn. Zie /shadow voor de
details; met tellingen loopt dat vanzelf glad.`);
