/**
 * Read-only analyse van de SRS-locatie-export.
 *
 * Voordat er 600+ locaties in het systeem gezet worden, wil je weten hoe de
 * codes in elkaar zitten: daar hangt de zone-indeling en de looproute aan, en die
 * bepaalt straks in welke volgorde een picker het magazijn doorloopt. Een
 * verkeerde route herstellen als er al gepikt wordt, is veel duurder dan er nu
 * vijf minuten naar kijken.
 *
 *   node scripts/analyse-locaties-csv.mjs "<pad naar csv>"
 */

import { readFile } from "node:fs/promises";

const pad = process.argv[2];
if (!pad) {
  console.error('Geef het pad naar de CSV mee: node scripts/analyse-locaties-csv.mjs "C:\\...\\data.csv"');
  process.exit(1);
}

/** SRS levert puntkomma-gescheiden met dubbele quotes om tekstvelden. */
function splitsRegel(regel) {
  const velden = [];
  let huidig = "";
  let inQuote = false;
  for (const teken of regel) {
    if (teken === '"') inQuote = !inQuote;
    else if (teken === ";" && !inQuote) {
      velden.push(huidig);
      huidig = "";
    } else huidig += teken;
  }
  velden.push(huidig);
  return velden.map((v) => v.trim());
}

const tekst = await readFile(pad, "utf8");
const regels = tekst.split(/\r?\n/).filter((r) => r.trim());
const kop = splitsRegel(regels[0]);

console.log("Kolommen:", kop.join(" | "), "\n");

const rijen = regels.slice(1).map((r) => {
  const v = splitsRegel(r);
  return {
    locatie: v[0],
    filiaal: v[1],
    laatsteMutatie: v[2],
    laatsteInventarisatie: v[3],
    barcodes: Number(v[4]) || 0,
    stuks: Number(v[5]) || 0,
    negatief: Number(v[6]) || 0,
  };
});

console.log(`${rijen.length} locaties gelezen\n`);

console.log("== filialen in het bestand");
const perFiliaal = new Map();
for (const r of rijen) {
  const f = perFiliaal.get(r.filiaal) ?? { locaties: 0, stuks: 0 };
  f.locaties += 1;
  f.stuks += r.stuks;
  perFiliaal.set(r.filiaal, f);
}
for (const [f, d] of perFiliaal) {
  console.log(`   ${f.padEnd(24)} ${String(d.locaties).padStart(4)} locaties · ${d.stuks} stuks`);
}

console.log("\n== totalen");
const totaalStuks = rijen.reduce((s, r) => s + r.stuks, 0);
const leeg = rijen.filter((r) => r.stuks === 0).length;
const negatief = rijen.filter((r) => r.negatief > 0);
console.log(`   ${totaalStuks} stuks · ${leeg} lege locaties · ${negatief.length} met negatieve voorraad`);
if (negatief.length) {
  console.log("   negatief op:", negatief.slice(0, 10).map((r) => r.locatie).join(", "));
}

console.log("\n== codepatronen");
const patronen = new Map();
for (const r of rijen) {
  /* Cijfers naar 9, letters naar A: zo zie je de vorm zonder de inhoud. */
  const vorm = r.locatie.replace(/\d/g, "9").replace(/[A-Za-z]/g, "A");
  patronen.set(vorm, (patronen.get(vorm) ?? 0) + 1);
}
for (const [vorm, n] of [...patronen.entries()].sort((a, b) => b[1] - a[1])) {
  const voorbeeld = rijen.find(
    (r) => r.locatie.replace(/\d/g, "9").replace(/[A-Za-z]/g, "A") === vorm
  );
  console.log(`   ${vorm.padEnd(12)} ${String(n).padStart(4)}×   bv. ${voorbeeld.locatie}`);
}

console.log("\n== eerste segment (mogelijke zone/gang)");
const zones = new Map();
for (const r of rijen) {
  const zone = r.locatie.split(/[\s-]/)[0];
  const z = zones.get(zone) ?? { locaties: 0, stuks: 0 };
  z.locaties += 1;
  z.stuks += r.stuks;
  zones.set(zone, z);
}
const gesorteerd = [...zones.entries()].sort((a, b) => a[0].localeCompare(b[0]));
console.log(`   ${gesorteerd.length} verschillende eerste segmenten`);
for (const [z, d] of gesorteerd.slice(0, 40)) {
  console.log(`   ${z.padEnd(8)} ${String(d.locaties).padStart(4)} locaties · ${d.stuks} stuks`);
}
if (gesorteerd.length > 40) console.log(`   … en ${gesorteerd.length - 40} meer`);

console.log("\n== inventarisatie-ouderdom (voor het telprogramma)");
function parseNl(d) {
  const m = String(d).match(/^(\d{2})-(\d{2})-(\d{4})/);
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00Z`) : null;
}
const nu = new Date();
const ouderdommen = rijen
  .map((r) => parseNl(r.laatsteInventarisatie))
  .filter(Boolean)
  .map((d) => Math.floor((nu - d) / 86400000));
if (ouderdommen.length) {
  ouderdommen.sort((a, b) => a - b);
  const mediaan = ouderdommen[Math.floor(ouderdommen.length / 2)];
  console.log(
    `   ${ouderdommen.length} met datum · jongste ${ouderdommen[0]} dagen · mediaan ${mediaan} · oudste ${ouderdommen[ouderdommen.length - 1]}`
  );
  console.log(`   ${rijen.length - ouderdommen.length} zonder inventarisatiedatum`);
}

console.log("\n== drukste locaties (meeste stuks)");
for (const r of [...rijen].sort((a, b) => b.stuks - a.stuks).slice(0, 10)) {
  console.log(
    `   ${r.locatie.padEnd(12)} ${String(r.stuks).padStart(5)} stuks · ${r.barcodes} barcodes`
  );
}
