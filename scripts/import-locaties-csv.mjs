/**
 * Importeert de SRS-locatie-export in wms.locations.
 *
 * DE LOOPROUTE IS DE KERN
 * -----------------------
 * `sort_order` bepaalt in welke volgorde een picker het magazijn doorloopt. Die
 * leiden we af uit de code: zone → gang → stelling → niveau → positie. Dat is
 * geen willekeurige sortering maar de fysieke werkelijkheid — je loopt een gang
 * in, en pakt daar van boven naar beneden.
 *
 * De sortering is later bij te stellen op /locaties; hij hoeft nu niet perfect te
 * zijn, wel consistent en verklaarbaar.
 *
 * WAT ER NIET GEBEURT
 * -------------------
 * Er wordt geen voorraad geboekt. Deze export bevat alleen totalen per vak, geen
 * artikelen. Het aantal stuks en het aantal barcodes gaan in de `extern_*`
 * kolommen als CONTROLEPUNT: na de echte beginvoorraad-import kun je per vak zien
 * of het klopt. Voorraad boeken zonder te weten wélke artikelen erin zitten zou
 * een getal opleveren dat nergens naar verwijst.
 *
 *   node scripts/import-locaties-csv.mjs "<pad>"            (proefrun)
 *   node scripts/import-locaties-csv.mjs "<pad>" --doen     (echt wegschrijven)
 *   node scripts/import-locaties-csv.mjs "<pad>" --doen --met-97
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon } from "@neondatabase/serverless";

const hier = dirname(fileURLToPath(import.meta.url));
const pad = process.argv[2];
const doen = process.argv.includes("--doen");
const met97 = process.argv.includes("--met-97");

if (!pad) {
  console.error('Gebruik: node scripts/import-locaties-csv.mjs "<pad naar csv>" [--doen] [--met-97]');
  process.exit(1);
}

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

/** "17-08-2026 09:37:17" → Date. SRS levert Nederlandse datumnotatie. */
function parseNlDatum(waarde) {
  const m = String(waarde).match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, dd, mm, jjjj, uu = "12", mi = "00", ss = "00"] = m;
  return new Date(`${jjjj}-${mm}-${dd}T${uu}:${mi}:${ss}+02:00`);
}

/**
 * Ontleedt een locatiecode.
 *
 * Vormen die in de export voorkomen:
 *   `H01 1A1`   letters + gang(2) + spatie + stelling(1) + niveau + positie
 *   `L3110A1`   idem zonder spatie, stelling is dan 2 cijfers
 *   `L35 11A2`  stelling van 2 cijfers mét spatie
 *   `RET01 1A1` drieletterige zone
 *   `PG-K001`   afwijkend: geen stelling/niveau-structuur
 */
function ontleed(code) {
  const schoon = code.trim().toUpperCase();

  const standaard = schoon.match(/^([A-Z]+)(\d{2})\s*(\d{1,2})([A-Z])(\d)$/);
  if (standaard) {
    const [, zone, gang, stelling, niveau, positie] = standaard;
    return {
      zone,
      gang: Number(gang),
      stelling: Number(stelling),
      niveau,
      positie: Number(positie),
      /* Altijd mét spatie opslaan: 551 van de 611 codes hebben die al, dus dat
         is de vorm die op de meeste labels staat. Zoeken gaat spatie-ongevoelig
         via code_zoek, dus een oud label zonder spatie werkt ook. */
      genormaliseerd: `${zone}${gang.toString().padStart(2, "0")} ${stelling}${niveau}${positie}`,
      structuur: true,
    };
  }

  const afwijkend = schoon.match(/^([A-Z]+)[-\s]?([A-Z]?\d+)$/);
  if (afwijkend) {
    return {
      zone: afwijkend[1],
      gang: 0,
      stelling: 0,
      niveau: "",
      positie: Number(String(afwijkend[2]).replace(/\D/g, "")) || 0,
      genormaliseerd: schoon,
      structuur: false,
    };
  }

  return {
    zone: schoon.split(/[\s-]/)[0] || "OVERIG",
    gang: 0,
    stelling: 0,
    niveau: "",
    positie: 0,
    genormaliseerd: schoon,
    structuur: false,
  };
}

/* ── Lezen ──────────────────────────────────────────────────────────────────── */

const tekst = await readFile(pad, "utf8");
const regels = tekst.split(/\r?\n/).filter((r) => r.trim());

const alles = regels.slice(1).map((r) => {
  const v = splitsRegel(r);
  const filiaalNummer = String(v[1]).split(/\s*-\s*/)[0].trim();
  return {
    code: v[0],
    filiaal: filiaalNummer,
    filiaalNaam: String(v[1]),
    laatsteMutatie: parseNlDatum(v[2]),
    laatsteInventarisatie: parseNlDatum(v[3]),
    skus: Number(v[4]) || 0,
    stuks: Number(v[5]) || 0,
    negatief: Number(v[6]) || 0,
    ...ontleed(v[0]),
  };
});

const rijen = alles.filter((r) => r.filiaal === "99" || (met97 && r.filiaal === "97"));
const overgeslagen = alles.length - rijen.length;

/* Dubbele genormaliseerde codes zijn een probleem: dan zouden `L31 10A1` en
   `L3110A1` op dezelfde locatie uitkomen en zou de een de ander overschrijven.
   Beter nu weten dan straks voorraad op de verkeerde plek. */
const perCode = new Map();
const dubbel = [];
for (const r of rijen) {
  if (perCode.has(r.genormaliseerd)) dubbel.push(r.genormaliseerd);
  else perCode.set(r.genormaliseerd, r);
}

/* ── Looproute ──────────────────────────────────────────────────────────────
   Zones alfabetisch, daarbinnen gang, stelling, niveau, positie. Stappen van 10
   zodat er later een vak tussen geschoven kan worden zonder alles te hernummeren. */
const gesorteerd = [...perCode.values()].sort(
  (a, b) =>
    a.zone.localeCompare(b.zone) ||
    a.gang - b.gang ||
    a.stelling - b.stelling ||
    a.niveau.localeCompare(b.niveau) ||
    a.positie - b.positie
);
gesorteerd.forEach((r, i) => {
  r.sortOrder = (i + 1) * 10;
});

const zones = new Map();
for (const r of gesorteerd) {
  const z = zones.get(r.zone) ?? { n: 0, stuks: 0 };
  z.n += 1;
  z.stuks += r.stuks;
  zones.set(r.zone, z);
}

console.log(`Locatie-import ${doen ? "(WEGSCHRIJVEN)" : "(PROEFRUN — niets wordt opgeslagen)"}\n`);
console.log(`  gelezen        : ${alles.length} regels`);
console.log(`  te importeren  : ${gesorteerd.length} locaties`);
console.log(`  overgeslagen   : ${overgeslagen}${met97 ? "" : " (filiaal 97; gebruik --met-97 om mee te nemen)"}`);
console.log(`  totaal stuks   : ${gesorteerd.reduce((s, r) => s + r.stuks, 0)}`);
console.log(`  zonder structuur: ${gesorteerd.filter((r) => !r.structuur).length}`);
if (dubbel.length) {
  console.log(`\n  LET OP — ${dubbel.length} dubbele codes na normalisatie: ${dubbel.slice(0, 5).join(", ")}`);
}

console.log("\n  zones (in looprichting):");
for (const [z, d] of zones) {
  console.log(`    ${z.padEnd(6)} ${String(d.n).padStart(4)} vakken · ${d.stuks} stuks`);
}

console.log("\n  eerste tien in looproute:");
for (const r of gesorteerd.slice(0, 10)) {
  console.log(`    ${String(r.sortOrder).padStart(5)}  ${r.genormaliseerd.padEnd(12)} (${r.code})`);
}

if (!doen) {
  console.log("\nProefrun klaar. Draai opnieuw met --doen om weg te schrijven.");
  process.exit(0);
}

/* ── Wegschrijven ───────────────────────────────────────────────────────────
   In batches, want de HTTP-driver doet één statement per call en 600 losse
   inserts zijn 600 round-trips. */
const BATCH = 200;
let geschreven = 0;

for (let i = 0; i < gesorteerd.length; i += BATCH) {
  const stuk = gesorteerd.slice(i, i + BATCH);
  const params = [];
  const groepen = [];
  let p = 1;

  for (const r of stuk) {
    groepen.push(
      `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`
    );
    params.push(
      r.genormaliseerd,
      r.structuur
        ? `Gang ${r.gang}, stelling ${r.stelling}, niveau ${r.niveau}${r.positie}`
        : `SRS-locatie ${r.code}`,
      r.zone,
      "pick",
      r.sortOrder,
      r.filiaal,
      r.laatsteInventarisatie ? r.laatsteInventarisatie.toISOString() : null,
      r.stuks,
      r.skus,
      new Date().toISOString(),
      r.code === r.genormaliseerd ? null : `In SRS bekend als ${r.code}`
    );
  }

  await sql.query(
    `INSERT INTO wms.locations
       (code, name, zone, kind, sort_order, filiaal,
        laatst_geteld_extern, extern_stuks, extern_skus, extern_gepeild_op, note)
     VALUES ${groepen.join(", ")}
     ON CONFLICT (code) DO UPDATE SET
       name                 = excluded.name,
       zone                 = excluded.zone,
       sort_order           = excluded.sort_order,
       filiaal              = excluded.filiaal,
       laatst_geteld_extern = excluded.laatst_geteld_extern,
       extern_stuks         = excluded.extern_stuks,
       extern_skus          = excluded.extern_skus,
       extern_gepeild_op    = excluded.extern_gepeild_op,
       note                 = coalesce(excluded.note, wms.locations.note),
       active               = true,
       updated_at           = now()`,
    params
  );
  geschreven += stuk.length;
  console.log(`  weggeschreven: ${geschreven}/${gesorteerd.length}`);
}

const [{ n }] = await sql`SELECT count(*)::int AS n FROM wms.locations WHERE active`;
const [ouderdom] = await sql`
  SELECT count(*) FILTER (WHERE laatst_geteld_extern < now() - interval '90 days')::int AS oud,
         count(*) FILTER (WHERE laatst_geteld_extern IS NULL)::int                      AS nooit
    FROM wms.locations WHERE active AND filiaal IS NOT NULL`;

console.log(`
Klaar. ${geschreven} locaties geïmporteerd; ${n} actieve locaties in het WMS.
Telprogramma heeft nu iets om op te sturen: ${ouderdom.oud} vakken zijn langer dan
90 dagen niet geïnventariseerd, ${ouderdom.nooit} nooit.

Er is GEEN voorraad geboekt — deze export bevat geen artikelen, alleen totalen.
De aantallen staan in extern_stuks als controlepunt: zie de view
wms.locatie_verschil zodra de echte beginvoorraad geladen is.`);
