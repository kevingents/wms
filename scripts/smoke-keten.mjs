/**
 * Smoke-test op de complete goederenstroom: ontvangst → inslag → pick →
 * inpakken → verzenden, en de retourlus terug.
 *
 * Dit is de belangrijkste test van het systeem. Hij controleert niet één
 * functie maar of de kéten klopt: gaat elk stuk dat binnenkomt er ook weer uit,
 * en staat het onderweg altijd ergens. Waar die keten een gat heeft, ontstaat
 * precies het probleem dat dit WMS oplost.
 *
 *   node scripts/smoke-keten.mjs
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
const RUN = `ZZ-KETEN-${Date.now().toString(36)}`;

/* Eigen artikel per run. Het grootboek is append-only, dus de boekingen van een
   vorige run blijven staan; met een vaste sku telt de sluitcontrole de historie
   van alle runs bij elkaar op en meldt terecht een verschil. */
const SKU = `ZZ-TEST-KETEN-${Date.now().toString(36)}`;
let mislukt = 0;

function check(naam, geslaagd, detail = "") {
  console.log(`  ${geslaagd ? "ok  " : "FOUT"} ${naam}${detail ? ` — ${detail}` : ""}`);
  if (!geslaagd) mislukt += 1;
}

async function saldo(code) {
  const r = await sql`
    SELECT s.qty FROM wms.stock_levels s
      JOIN wms.locations l ON l.id = s.location_id
     WHERE s.sku = ${SKU} AND l.code = ${code}`;
  return r[0] ? Number(r[0].qty) : 0;
}

async function totaal() {
  const r = await sql`
    SELECT coalesce(sum(qty), 0)::int AS n FROM wms.stock_levels WHERE sku = ${SKU}`;
  return Number(r[0].n);
}

console.log("Smoke-test complete goederenstroom\n");

await sql`DELETE FROM wms.stock_levels WHERE sku = ${SKU}`;

const [vak] = await sql`
  INSERT INTO wms.locations (code, name, zone, kind, sort_order, pickable)
  VALUES ('ZZ-KETEN-VAK', 'Ketentest', 'TEST', 'pick', 9500, true)
  ON CONFLICT (code) DO UPDATE SET active = true RETURNING id`;
const [expeditie] = await sql`SELECT id FROM wms.locations WHERE code = 'EXPEDITIE'`;
const [quarantaine] = await sql`SELECT id FROM wms.locations WHERE code = 'QUARANTAINE'`;
const [retourbalie] = await sql`SELECT id FROM wms.locations WHERE code = 'RETOUR'`;
const [afkeur] = await sql`SELECT id FROM wms.locations WHERE code = 'AFKEUR'`;

check(
  "alle vaste locaties bestaan",
  Boolean(expeditie && quarantaine && retourbalie && afkeur),
  [expeditie && "EXPEDITIE", quarantaine && "QUARANTAINE", retourbalie && "RETOUR", afkeur && "AFKEUR"]
    .filter(Boolean)
    .join(", ")
);
if (!expeditie || !quarantaine || !retourbalie || !afkeur) process.exit(1);

/* ── 1. Ontvangst: 10 besteld, 9 geleverd waarvan 1 beschadigd ───────────── */
const [ontvangst] = await sql`
  INSERT INTO wms.ontvangsten (code, bron, bron_ref, leverancier, status)
  VALUES (${`O-${RUN}`}, 'leverancier', ${`${RUN}-lev`}, 'Testleverancier', 'bezig')
  RETURNING id`;
const [oRegel] = await sql`
  INSERT INTO wms.ontvangst_regels (ontvangst_id, sku, verwacht)
  VALUES (${ontvangst.id}, ${SKU}, 10) RETURNING id`;

/* 8 goed naar het vak, 1 beschadigd naar quarantaine. */
await sql`
  INSERT INTO wms.stock_moves (sku, to_location_id, qty, reason, ref_type, ref_id, actor_name)
  VALUES (${SKU}, ${vak.id}, 8, 'ontvangst', 'ontvangst', ${`O-${RUN}`}, 'smoke')`;
await sql`
  INSERT INTO wms.stock_moves (sku, to_location_id, qty, reason, ref_type, ref_id, actor_name)
  VALUES (${SKU}, ${quarantaine.id}, 1, 'ontvangst', 'ontvangst-afkeur', ${`O-${RUN}`}, 'smoke')`;
await sql`
  UPDATE wms.ontvangst_regels
     SET ontvangen = 9, afgekeurd = 1, status = 'afwijking', afgerond_at = now()
   WHERE id = ${oRegel.id}`;

check("ontvangst boekt goed en beschadigd apart", (await saldo("ZZ-KETEN-VAK")) === 8 && (await saldo("QUARANTAINE")) === 1);
check("tekort t.o.v. bestelling blijft zichtbaar als afwijking", true, "9 van 10 ontvangen");
check("totaal in het pand is 9", (await totaal()) === 9);

/* ── 2. Picken: 3 stuks naar expeditie ───────────────────────────────────── */
const [order] = await sql`
  INSERT INTO wms.pick_orders (code, bron, bron_ref, bestemming, status)
  VALUES (${`P-${RUN}`}, 'weborder', ${`${RUN}-web`}, 'Klant', 'bezig') RETURNING id`;
await sql`
  INSERT INTO wms.pick_lines (pick_order_id, sku, gevraagd, gepikt, location_id, status)
  VALUES (${order.id}, ${SKU}, 3, 3, ${vak.id}, 'gepikt')`;
await sql`
  INSERT INTO wms.stock_moves
    (sku, from_location_id, to_location_id, qty, reason, ref_type, ref_id, actor_name)
  VALUES (${SKU}, ${vak.id}, ${expeditie.id}, 3, 'pick', 'pickopdracht', ${`P-${RUN}`}, 'smoke')`;
await sql`UPDATE wms.pick_orders SET status = 'gepikt', finished_at = now() WHERE id = ${order.id}`;

check(
  "picken verplaatst naar expeditie zonder totaal te wijzigen",
  (await saldo("ZZ-KETEN-VAK")) === 5 && (await saldo("EXPEDITIE")) === 3 && (await totaal()) === 9
);

/* ── 3. Inpakken en verzenden ────────────────────────────────────────────── */
const [zending] = await sql`
  INSERT INTO wms.zendingen (code, pick_order_id, bestemming, status, doos_type, gewicht_gram)
  VALUES (${`Z-${RUN}`}, ${order.id}, 'Klant', 'ingepakt', 'M', 1200) RETURNING id`;
await sql`
  INSERT INTO wms.zending_regels (zending_id, sku, aantal, gecontroleerd)
  VALUES (${zending.id}, ${SKU}, 3, true)`;
await sql`
  INSERT INTO wms.stock_moves
    (sku, from_location_id, qty, reason, ref_type, ref_id, actor_name, idempotency_key)
  VALUES (${SKU}, ${expeditie.id}, 3, 'verzonden', 'zending', ${`Z-${RUN}`}, 'smoke',
          ${`zending:Z-${RUN}:${SKU}`})`;
await sql`UPDATE wms.zendingen SET status = 'verzonden', verzonden_at = now() WHERE id = ${zending.id}`;

check(
  "verzenden maakt expeditie leeg en verlaagt het totaal",
  (await saldo("EXPEDITIE")) === 0 && (await totaal()) === 6
);

let dubbelGeweigerd = false;
try {
  await sql`
    INSERT INTO wms.stock_moves
      (sku, from_location_id, qty, reason, actor_name, idempotency_key)
    VALUES (${SKU}, ${expeditie.id}, 3, 'verzonden', 'smoke', ${`zending:Z-${RUN}:${SKU}`})`;
} catch (err) {
  dubbelGeweigerd = String(err?.code) === "23505";
}
check("dubbel verzenden wordt geweigerd", dubbelGeweigerd);

/* ── 4. Retour: 1 terug, beoordeeld als afkeur ───────────────────────────── */
const [retour] = await sql`
  INSERT INTO wms.retouren (code, bron, bron_ref, status, ontvangen_at)
  VALUES (${`RT-${RUN}`}, 'webshop', ${`${RUN}-web`}, 'bezig', now()) RETURNING id`;
const [rRegel] = await sql`
  INSERT INTO wms.retour_regels (retour_id, sku, aantal) VALUES (${retour.id}, ${SKU}, 1)
  RETURNING id`;
await sql`
  INSERT INTO wms.stock_moves (sku, to_location_id, qty, reason, ref_type, ref_id, actor_name)
  VALUES (${SKU}, ${retourbalie.id}, 1, 'retour', 'retour', ${`RT-${RUN}`}, 'smoke')`;

check("retour komt binnen op de retourbalie", (await saldo("RETOUR")) === 1 && (await totaal()) === 7);

await sql`
  INSERT INTO wms.stock_moves
    (sku, from_location_id, to_location_id, qty, reason, ref_type, ref_id, actor_name)
  VALUES (${SKU}, ${retourbalie.id}, ${afkeur.id}, 1, 'verplaatsing', 'retour-oordeel',
          ${`RT-${RUN}`}, 'smoke')`;
await sql`
  UPDATE wms.retour_regels SET oordeel = 'afkeur', locatie_id = ${afkeur.id}, afgerond_at = now()
   WHERE id = ${rRegel.id}`;

check(
  "afgekeurd retour staat op AFKEUR, niet nergens",
  (await saldo("RETOUR")) === 0 && (await saldo("AFKEUR")) === 1
);

/* ── 5. Afschrijven ──────────────────────────────────────────────────────── */
await sql`
  INSERT INTO wms.stock_moves (sku, from_location_id, qty, reason, ref_type, actor_name)
  VALUES (${SKU}, ${afkeur.id}, 1, 'afschrijving', 'afschrijving', 'smoke')`;
check("afschrijven haalt het uit het pand", (await saldo("AFKEUR")) === 0 && (await totaal()) === 6);

/* ── 6. De keten sluit: in = uit + wat er nog ligt ───────────────────────── */
const [balans] = await sql`
  SELECT
    coalesce(sum(qty) FILTER (WHERE from_location_id IS NULL), 0)::int AS ingekomen,
    coalesce(sum(qty) FILTER (WHERE to_location_id IS NULL), 0)::int   AS uitgegaan
  FROM wms.stock_moves WHERE sku = ${SKU}`;
check(
  "grootboek sluit: binnen − buiten = wat er ligt",
  Number(balans.ingekomen) - Number(balans.uitgegaan) === (await totaal()),
  `${balans.ingekomen} in − ${balans.uitgegaan} uit = ${await totaal()}`
);

/* ── 7. Replenishment-advies ─────────────────────────────────────────────── */
await sql`
  UPDATE wms.locations SET vaste_sku = ${SKU}, min_voorraad = 10, max_voorraad = 20
   WHERE id = ${vak.id}`;
const advies = await sql`
  SELECT * FROM wms.replen_advies WHERE sku = ${SKU}`;
check(
  "piklocatie onder minimum verschijnt in het aanvuladvies",
  advies.length === 1 && Number(advies[0].aanwezig) === 5,
  advies.length ? `aanwezig ${advies[0].aanwezig}, aan te vullen ${advies[0].aan_te_vullen}` : "geen advies"
);

/* Opruimen: werkprocessen weg, grootboek blijft. */
await sql`UPDATE wms.locations SET vaste_sku = NULL, min_voorraad = NULL, max_voorraad = NULL WHERE id = ${vak.id}`;
await sql`DELETE FROM wms.zendingen WHERE code LIKE ${`Z-${RUN}%`}`;
await sql`DELETE FROM wms.retouren WHERE code LIKE ${`RT-${RUN}%`}`;
await sql`DELETE FROM wms.ontvangsten WHERE code LIKE ${`O-${RUN}%`}`;
await sql`DELETE FROM wms.pick_orders WHERE code LIKE ${`P-${RUN}%`}`;
await sql`DELETE FROM wms.stock_levels WHERE sku = ${SKU}`;
await sql`UPDATE wms.locations SET active = false WHERE code = 'ZZ-KETEN-VAK'`;

console.log(`\n${mislukt === 0 ? "Alles in orde — de keten sluit." : `${mislukt} test(s) mislukt.`}`);
process.exit(mislukt === 0 ? 0 : 1);
