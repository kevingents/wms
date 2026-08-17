import { query, queryOne, BoekingsFout } from "./db";
import { instelling } from "./instellingen";
import { zoekArtikel, zoekLocatie } from "./voorraad";

/**
 * Labels — de fysieke kant van het scansysteem.
 *
 * WAAROM DIT GEEN BIJZAAK IS
 * --------------------------
 * De hele app gaat ervan uit dat een medewerker een vak kan scannen. Dat kan
 * alleen als daar een barcode op zit. Zolang er locaties zonder label zijn, is
 * dat deel van het magazijn onbereikbaar voor het systeem — daarom telt dit
 * scherm dat aantal hardop mee, en is het geen instelling maar een voorwaarde.
 *
 * TWEE UITVOEREN, ÉÉN INHOUD
 * --------------------------
 * Een magazijn heeft een Zebra-labelprinter (ZPL) of een gewone printer met een
 * vel etiketten. Beide moeten hetzelfde label opleveren, dus staat de inhoud van
 * een label één keer beschreven (`LabelInhoud`) en zijn ZPL en HTML twee
 * renderers over diezelfde gegevens. Een tweede omschrijving zou gegarandeerd
 * uit elkaar lopen.
 *
 * WAAROM EEN EIGEN CODE128-ENCODER
 * --------------------------------
 * Voor ZPL doet de printer het barcodewerk zelf (^BC). Voor de HTML-variant moet
 * iemand de strepen tekenen. Code 128 is ~130 regels tabel en optellen; een
 * dependency erbij is voor dit stukje meer risico (build, licentie, onderhoud)
 * dan het bespaart. De encoder wordt bovendien voor ZPL hergebruikt om te
 * berekenen hoe breed één module mag zijn zodat de barcode op het etiket past.
 *
 * FORMAAT EN PRINTERTAAL
 * ----------------------
 * Beide komen uit de instellingen (`labels.formaat`, `labels.printer_taal`), niet
 * uit de environment: welk etiket in de printer zit verandert zonder redeploy.
 * Het formaat mag een dpi meekrijgen (`50x25@300`) — de meeste desktop-Zebra's
 * zijn 203 dpi en dat is de standaard, maar een 300 dpi-printer rekent in andere
 * dots en zou anders halve labels afdrukken.
 *
 * ELKE PRINT WORDT VASTGELEGD
 * ---------------------------
 * `wms.label_prints` beantwoordt twee vragen die je anders alleen lopend kunt
 * beantwoorden: welke vakken hebben nog nooit een label gehad, en is dit vak na
 * de verhuizing opnieuw geprint. Een voorbeeld op het scherm is géén print en
 * wordt dus niet vastgelegd.
 */

/* ── Vormen ────────────────────────────────────────────────────────────────── */

export type LabelSoort = "locatie" | "artikel" | "collo" | "zending";

export const LABEL_SOORTEN: { waarde: LabelSoort; label: string; uitleg: string }[] = [
  {
    waarde: "locatie",
    label: "Locatie",
    uitleg: "Het vakje op de stelling. Zonder dit label is het vak niet scanbaar.",
  },
  {
    waarde: "artikel",
    label: "Artikel",
    uitleg: "Voor artikelen zonder leesbare fabrieksbarcode.",
  },
  { waarde: "collo", label: "Collo", uitleg: "Doos, pallet of rolcontainer." },
  { waarde: "zending", label: "Zending", uitleg: "Interne sticker op een uitgaande doos." },
];

/** zpl = Zebra-printer, html = gewone printer (browser drukt af of maakt pdf). */
export type PrinterTaal = "zpl" | "html";

export interface LabelFormaat {
  breedteMm: number;
  hoogteMm: number;
  dpi: number;
  naam: string;
}

/** Wat er op één label staat — losgekoppeld van hoe het geprint wordt. */
export interface LabelInhoud {
  soort: LabelSoort;
  /** Wat in wms.label_prints.object_id komt; meestal gelijk aan de barcode. */
  objectId: string;
  /** Wat de scanner leest. */
  barcode: string;
  /** Groot en leesbaar, voor het menselijk oog. */
  titel: string;
  /** Kleine regels eronder; wat niet past valt weg. */
  regels: string[];
}

export interface LabelBestand {
  taal: PrinterTaal;
  mime: string;
  bestandsnaam: string;
  inhoud: string;
  aantalLabels: number;
}

export interface LocatieZonderLabel {
  id: number;
  code: string;
  zone: string | null;
  kind: string;
  sort_order: number;
}

export interface PrintRegel {
  id: number;
  soort: string;
  object_id: string;
  aantal: number;
  formaat: string | null;
  geprint_door: string | null;
  created_at: string;
}

/* ── Instellingen ──────────────────────────────────────────────────────────── */

const STANDAARD_FORMAAT: LabelFormaat = {
  breedteMm: 50,
  hoogteMm: 25,
  dpi: 203,
  naam: "50x25",
};

/** "50x25" of "100x150@300". Onleesbare invoer valt terug op 50x25 @203 dpi. */
export function leesFormaat(waarde: unknown): LabelFormaat {
  const m = String(waarde ?? "").trim().match(/^(\d{1,3})\s*[x×*]\s*(\d{1,3})(?:\s*@\s*(\d{2,4}))?$/i);
  if (!m) return STANDAARD_FORMAAT;
  const breedteMm = Number(m[1]);
  const hoogteMm = Number(m[2]);
  const dpi = m[3] ? Number(m[3]) : 203;
  if (breedteMm < 10 || hoogteMm < 10) return STANDAARD_FORMAAT;
  return {
    breedteMm,
    hoogteMm,
    dpi: dpi >= 100 && dpi <= 900 ? dpi : 203,
    naam: `${breedteMm}x${hoogteMm}`,
  };
}

/**
 * De instelling kent 'zpl' of 'pdf'. Alles wat geen zpl is loopt via HTML: de
 * browser drukt dat af op een gewone printer, en "opslaan als pdf" zit in
 * datzelfde printvenster. Een eigen pdf-generator zou een dependency zijn die
 * exact hetzelfde vel oplevert.
 */
export function leesTaal(waarde: unknown): PrinterTaal {
  return String(waarde ?? "").trim().toLowerCase() === "zpl" ? "zpl" : "html";
}

export async function labelInstellingen(): Promise<{
  formaat: LabelFormaat;
  taal: PrinterTaal;
}> {
  const [formaat, taal] = await Promise.all([
    instelling("labels.formaat"),
    instelling("labels.printer_taal"),
  ]);
  return { formaat: leesFormaat(formaat), taal: leesTaal(taal) };
}

/* ── Code 128 ──────────────────────────────────────────────────────────────── */

/**
 * De 107 patronen van Code 128. Elk patroon is de breedte in modules van
 * afwisselend streep, wit, streep, … (het stopteken heeft er zeven).
 */
const CODE128_PATRONEN = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232", "2331112",
];

const START_B = 104;
const START_C = 105;
const STOP = 106;

/**
 * Tekencodes inclusief start, controlegetal en stop.
 *
 * Subset C halveert de breedte bij cijferreeksen (twee cijfers per teken) en dat
 * scheelt op een etiket van 50 mm echt iets bij een EAN van 13 cijfers. Alleen
 * bij een even reeks pure cijfers is dat zonder tussentijds wisselen mogelijk;
 * al het andere gaat in subset B, dat de hele leesbare ASCII dekt.
 */
function code128Waarden(tekst: string): number[] {
  const waarden: number[] = [];
  if (/^\d+$/.test(tekst) && tekst.length % 2 === 0 && tekst.length >= 4) {
    waarden.push(START_C);
    for (let i = 0; i < tekst.length; i += 2) waarden.push(Number(tekst.slice(i, i + 2)));
  } else {
    waarden.push(START_B);
    for (const teken of tekst) {
      const c = teken.charCodeAt(0);
      if (c < 32 || c > 126) {
        throw new BoekingsFout(
          `De code "${tekst}" bevat een teken dat niet in een barcode past.`,
          "onbarcodeerbaar"
        );
      }
      waarden.push(c - 32);
    }
  }
  const controle =
    waarden.reduce((som, w, i) => som + w * (i === 0 ? 1 : i), 0) % 103;
  waarden.push(controle, STOP);
  return waarden;
}

interface Balken {
  /** Alleen de zwarte strepen; wit is de ruimte ertussen. */
  strepen: { x: number; breedte: number }[];
  /** Totale breedte in modules, inclusief stille zones links en rechts. */
  modules: number;
}

/** Rustzone: zonder wit naast de barcode leest geen enkele scanner hem. */
const STILLE_ZONE = 10;

function code128Balken(tekst: string): Balken {
  const strepen: { x: number; breedte: number }[] = [];
  let x = STILLE_ZONE;
  for (const waarde of code128Waarden(tekst)) {
    const patroon = CODE128_PATRONEN[waarde];
    for (let i = 0; i < patroon.length; i++) {
      const breedte = Number(patroon[i]);
      if (i % 2 === 0) strepen.push({ x, breedte });
      x += breedte;
    }
  }
  return { strepen, modules: x + STILLE_ZONE };
}

/**
 * Barcode als SVG. De viewBox is in modules en `preserveAspectRatio="none"`
 * rekt hem naar de doos — dat houdt de strepen scherp op elke printresolutie,
 * anders dan een afbeelding op een vaste pixelmaat.
 */
export function barcodeSvg(tekst: string): string {
  const { strepen, modules } = code128Balken(tekst);
  const rechthoeken = strepen
    .map((s) => `<rect x="${s.x}" y="0" width="${s.breedte}" height="100"/>`)
    .join("");
  return (
    `<svg viewBox="0 0 ${modules} 100" preserveAspectRatio="none" ` +
    `xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" role="img" ` +
    `aria-label="Barcode ${htmlVeilig(tekst)}"><g fill="#000">${rechthoeken}</g></svg>`
  );
}

/* ── Inhoud opbouwen ───────────────────────────────────────────────────────── */

export async function maakLocatieLabel(code: string): Promise<LabelInhoud> {
  const locatie = await zoekLocatie(code);
  if (!locatie) {
    throw new BoekingsFout(`Onbekende locatie: ${code}`, "geen_locatie");
  }
  const regels = [
    locatie.zone ? `Zone ${locatie.zone}` : "",
    locatie.name ?? "",
  ].filter(Boolean);
  return {
    soort: "locatie",
    objectId: locatie.code,
    barcode: locatie.code,
    titel: locatie.code,
    regels,
  };
}

/**
 * Artikellabel. De barcode is bij voorkeur de fabrieksbarcode, want die staat
 * ook op het artikel zelf — twee verschillende codes voor hetzelfde stuk is
 * vragen om een misscan. Heeft het artikel er geen, dan gaat de sku in de
 * barcode; scan-resolutie zoekt eerst op barcode en daarna op sku, dus beide
 * werken.
 */
export async function maakArtikelLabel(code: string): Promise<LabelInhoud> {
  const artikel = await zoekArtikel(code);
  if (!artikel) {
    throw new BoekingsFout(`Onbekend artikel: ${code}`, "geen_artikel");
  }
  const kenmerken = [
    artikel.maat ? `Maat ${artikel.maat}` : "",
    artikel.kleur ?? "",
  ].filter(Boolean);
  const regels = [
    [artikel.merk, artikel.omschrijving].filter(Boolean).join(" — "),
    kenmerken.join(" · "),
  ].filter(Boolean);
  return {
    soort: "artikel",
    objectId: artikel.sku,
    barcode: artikel.barcode || artikel.sku,
    titel: artikel.sku,
    regels,
  };
}

export async function maakColloLabel(code: string): Promise<LabelInhoud> {
  const collo = await queryOne<{
    code: string;
    soort: string;
    status: string;
    locatie_code: string | null;
    stuks: number;
  }>(
    `SELECT c.code, c.soort, c.status, l.code AS locatie_code,
            (SELECT coalesce(sum(r.aantal), 0) FROM wms.collo_regels r
              WHERE r.collo_id = c.id)::int AS stuks
       FROM wms.colli c
       LEFT JOIN wms.locations l ON l.id = c.locatie_id
      WHERE upper(c.code) = upper($1)`,
    [code.trim()]
  );
  if (!collo) throw new BoekingsFout(`Onbekend collo: ${code}`, "geen_collo");

  const regels = [
    `${collo.soort} · ${collo.stuks} stuks`,
    collo.locatie_code ? `Staat op ${collo.locatie_code}` : "",
  ].filter(Boolean);
  return {
    soort: "collo",
    objectId: collo.code,
    barcode: collo.code,
    titel: collo.code,
    regels,
  };
}

/**
 * Zendinglabel — de interne sticker, niet het vervoerderslabel. Dat laatste komt
 * van DHL of Sendcloud en heeft z'n eigen vorm; deze sticker maakt de doos op de
 * kade terugvindbaar zolang die er nog geen heeft.
 */
export async function maakZendingLabel(code: string): Promise<LabelInhoud> {
  const zending = await queryOne<{
    code: string;
    bestemming: string | null;
    vervoerder: string | null;
    tracking: string | null;
    stuks: number;
  }>(
    `SELECT z.code, z.bestemming, z.vervoerder, z.tracking,
            (SELECT coalesce(sum(r.aantal), 0) FROM wms.zending_regels r
              WHERE r.zending_id = z.id)::int AS stuks
       FROM wms.zendingen z
      WHERE upper(z.code) = upper($1)`,
    [code.trim()]
  );
  if (!zending) throw new BoekingsFout(`Onbekende zending: ${code}`, "geen_zending");

  const regels = [
    zending.bestemming ?? "",
    [zending.vervoerder, zending.tracking].filter(Boolean).join(" · ") ||
      `${zending.stuks} stuks`,
  ].filter(Boolean);
  return {
    soort: "zending",
    objectId: zending.code,
    barcode: zending.code,
    titel: zending.code,
    regels,
  };
}

const MAX_CODES = 1000;

/**
 * Zoekt alle opgegeven codes op. Eén onbekende code laat de hele partij falen:
 * een stapel etiketten waar er stilletjes drie van missen, ontdek je pas bij de
 * stelling — en dan sta je met de verkeerde stapel in je hand.
 */
export async function maakLabels(
  soort: LabelSoort,
  codes: string[]
): Promise<LabelInhoud[]> {
  const schoon = Array.from(
    new Set(codes.map((c) => String(c ?? "").trim()).filter(Boolean))
  );
  if (schoon.length === 0) {
    throw new BoekingsFout("Kies eerst waar je een label voor wilt.", "geen_codes");
  }
  if (schoon.length > MAX_CODES) {
    throw new BoekingsFout(
      `Dat zijn ${schoon.length} labels. Doe het in stukken van maximaal ${MAX_CODES}.`,
      "te_veel"
    );
  }

  const uit: LabelInhoud[] = [];
  for (const code of schoon) {
    switch (soort) {
      case "locatie":
        uit.push(await maakLocatieLabel(code));
        break;
      case "artikel":
        uit.push(await maakArtikelLabel(code));
        break;
      case "collo":
        uit.push(await maakColloLabel(code));
        break;
      case "zending":
        uit.push(await maakZendingLabel(code));
        break;
      default:
        throw new BoekingsFout(`Onbekende labelsoort: ${soort}`, "onbekende_soort");
    }
  }
  return uit;
}

/* ── Indeling ──────────────────────────────────────────────────────────────── */

interface Indeling {
  margeMm: number;
  titelMm: number;
  regelMm: number;
  /** Wat er na titel en regels overblijft; de barcode vult die ruimte. */
  barcodeMm: number;
  /** Hoeveel regels er onder de titel passen. */
  maxRegels: number;
}

function indeling(formaat: LabelFormaat): Indeling {
  const margeMm = Math.max(1, Math.round(Math.min(formaat.breedteMm, formaat.hoogteMm) * 0.05));
  const bruikbaar = formaat.hoogteMm - 2 * margeMm;
  const titelMm = Math.round(bruikbaar * 0.26 * 10) / 10;
  const regelMm = Math.round(bruikbaar * 0.13 * 10) / 10;
  const maxRegels = bruikbaar > 18 ? 2 : 1;
  const barcodeMm =
    Math.round((bruikbaar - titelMm * 1.15 - maxRegels * regelMm * 1.3) * 10) / 10;
  return {
    margeMm,
    titelMm,
    regelMm,
    barcodeMm: Math.max(bruikbaar * 0.25, barcodeMm),
    maxRegels,
  };
}

/* ── ZPL ───────────────────────────────────────────────────────────────────── */

/** ^ en ~ zijn commandotekens in ZPL; in veldtekst zouden ze het label slopen. */
function zplVeilig(tekst: string): string {
  return tekst.replace(/[\^~\\]/g, " ").replace(/\s+/g, " ").trim();
}

export function naarZpl(
  labels: LabelInhoud[],
  formaat: LabelFormaat,
  aantalPerLabel = 1
): string {
  const dotsPerMm = formaat.dpi / 25.4;
  const mm = (waarde: number) => Math.round(waarde * dotsPerMm);

  const vorm = indeling(formaat);
  const breedte = mm(formaat.breedteMm);
  const hoogte = mm(formaat.hoogteMm);
  const marge = mm(vorm.margeMm);
  const barcodeHoogte = mm(vorm.barcodeMm);
  const titelHoogte = mm(vorm.titelMm);
  const regelHoogte = mm(vorm.regelMm);
  const bruikbareBreedte = breedte - 2 * marge;

  const blokken = labels.map((label) => {
    const barcode = zplVeilig(label.barcode);
    /* De printer tekent de barcode zelf, maar bepaalt niet of hij past. Met het
       modulegetal uit de eigen encoder kiezen we een modulebreedte die binnen
       het etiket blijft in plaats van er rechts vanaf te lopen. */
    const { modules } = code128Balken(barcode);
    const module = Math.min(6, Math.max(1, Math.floor(bruikbareBreedte / modules)));

    const regels: string[] = [
      "^XA",
      "^CI28",
      `^PW${breedte}`,
      `^LL${hoogte}`,
      "^LH0,0",
      `^BY${module},2.5,${barcodeHoogte}`,
      `^FO${marge},${marge}^BCN,${barcodeHoogte},N,N,N^FD${barcode}^FS`,
      `^FO${marge},${marge + barcodeHoogte + Math.round(regelHoogte * 0.3)}` +
        `^A0N,${titelHoogte},${titelHoogte}^FD${zplVeilig(label.titel)}^FS`,
    ];

    let y = marge + barcodeHoogte + Math.round(regelHoogte * 0.3) + Math.round(titelHoogte * 1.15);
    for (const regel of label.regels.slice(0, vorm.maxRegels)) {
      regels.push(
        `^FO${marge},${y}^A0N,${regelHoogte},${regelHoogte}^FD${zplVeilig(regel)}^FS`
      );
      y += Math.round(regelHoogte * 1.3);
    }

    /* ^PQ laat de printer de kopieën maken; hetzelfde blok N keer versturen zou
       alleen de overdracht langer maken. */
    if (aantalPerLabel > 1) regels.push(`^PQ${aantalPerLabel},0,0,N`);
    regels.push("^XZ");
    return regels.join("\n");
  });

  return `${blokken.join("\n")}\n`;
}

/* ── HTML ──────────────────────────────────────────────────────────────────── */

function htmlVeilig(tekst: string): string {
  return tekst
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Eén compleet HTML-document met alle etiketten. `@page` op het labelformaat
 * zorgt dat een rol-etikettenprinter of een vel A4 met de juiste maat afdrukt;
 * de barcode zit als SVG in het document, dus er is geen enkele externe bron
 * nodig — belangrijk, want dit venster kan ook offline geopend worden.
 */
export function naarHtml(
  labels: LabelInhoud[],
  formaat: LabelFormaat,
  aantalPerLabel = 1
): string {
  const vorm = indeling(formaat);

  const etiketten: string[] = [];
  for (const label of labels) {
    const regels = label.regels
      .slice(0, vorm.maxRegels)
      .map((r) => `<span>${htmlVeilig(r)}</span>`)
      .join("");
    const etiket =
      `<div class="etiket">` +
      `<div class="streepjes">${barcodeSvg(label.barcode)}</div>` +
      `<div class="titel">${htmlVeilig(label.titel)}</div>` +
      `<div class="regels">${regels}</div>` +
      `</div>`;
    for (let i = 0; i < aantalPerLabel; i++) etiketten.push(etiket);
  }

  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<title>Labels ${htmlVeilig(formaat.naam)}</title>
<style>
  @page { size: ${formaat.breedteMm}mm ${formaat.hoogteMm}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: "Helvetica Neue", Arial, sans-serif; color: #000; }
  .etiket {
    width: ${formaat.breedteMm}mm;
    height: ${formaat.hoogteMm}mm;
    padding: ${vorm.margeMm}mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
    break-after: page;
    page-break-after: always;
  }
  .etiket:last-child { break-after: auto; page-break-after: auto; }
  .streepjes { flex: 1 1 auto; min-height: ${Math.round(vorm.barcodeMm * 0.6)}mm; }
  .streepjes svg { display: block; width: 100%; height: 100%; }
  .titel {
    flex: 0 0 auto;
    font-size: ${vorm.titelMm}mm;
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
  }
  .regels { flex: 0 0 auto; font-size: ${vorm.regelMm}mm; line-height: 1.25; }
  .regels span { display: block; white-space: nowrap; overflow: hidden; }
  @media screen {
    body { background: #eef1f5; padding: 6mm 0; }
    .etiket { background: #fff; margin: 0 auto 4mm; box-shadow: 0 1px 4px rgba(0,0,0,.2); }
  }
</style>
</head>
<body>${etiketten.join("")}</body>
</html>
`;
}

/* ── Vastleggen ────────────────────────────────────────────────────────────── */

export async function legPrintVast(args: {
  soort: LabelSoort;
  objectIds: string[];
  aantal: number;
  formaat: string;
  door: string | null;
}): Promise<void> {
  if (args.objectIds.length === 0) return;
  /* Eén statement met unnest: de HTTP-driver doet één statement per call, dus
     een lus van 300 inserts zou 300 rondjes naar de database zijn. */
  await query(
    `INSERT INTO wms.label_prints (soort, object_id, aantal, formaat, geprint_door)
     SELECT $1, code, $3, $4, $5 FROM unnest($2::text[]) AS t(code)`,
    [args.soort, args.objectIds, args.aantal, args.formaat, args.door]
  );
}

/* ── Lezen ─────────────────────────────────────────────────────────────────── */

/** Uit de view wms.locaties_zonder_label: actief, maar nooit geprint. */
export async function locatiesZonderLabel(): Promise<LocatieZonderLabel[]> {
  return query<LocatieZonderLabel>(
    `SELECT id, code, zone, kind, sort_order
       FROM wms.locaties_zonder_label
      ORDER BY sort_order, code`
  );
}

export interface LabelStand {
  actieve_locaties: number;
  zonder_label: number;
}

export async function labelStand(): Promise<LabelStand> {
  const rij = await queryOne<Record<string, number>>(
    `SELECT (SELECT count(*) FROM wms.locations WHERE active)::int      AS actieve_locaties,
            (SELECT count(*) FROM wms.locaties_zonder_label)::int       AS zonder_label`
  );
  return {
    actieve_locaties: Number(rij?.actieve_locaties ?? 0),
    zonder_label: Number(rij?.zonder_label ?? 0),
  };
}

export async function recentePrints(limiet = 15): Promise<PrintRegel[]> {
  return query<PrintRegel>(
    `SELECT id, soort, object_id, aantal, formaat, geprint_door, created_at
       FROM wms.label_prints
      ORDER BY created_at DESC, id DESC
      LIMIT $1`,
    [limiet]
  );
}

/* ── Alles bij elkaar ──────────────────────────────────────────────────────── */

function bestandsnaam(soort: LabelSoort, taal: PrinterTaal): string {
  const dag = new Date().toISOString().slice(0, 10);
  return `labels-${soort}-${dag}.${taal === "zpl" ? "zpl" : "html"}`;
}

/**
 * De hele keten: codes opzoeken, renderen in de gevraagde taal en de print
 * vastleggen. `vastleggen: false` is de voorbeeldweergave — die mag niet
 * meetellen, anders lijkt een vak een label te hebben omdat iemand ernaar keek.
 */
export async function maakLabelBestand(args: {
  soort: LabelSoort;
  codes: string[];
  aantal?: number;
  taal?: PrinterTaal;
  door?: string | null;
  vastleggen?: boolean;
}): Promise<LabelBestand> {
  const aantal = Math.floor(Number(args.aantal ?? 1));
  if (!Number.isInteger(aantal) || aantal < 1 || aantal > 50) {
    throw new BoekingsFout("Aantal per label moet tussen 1 en 50 liggen.", "ongeldig_aantal");
  }

  const instellingen = await labelInstellingen();
  const formaat = instellingen.formaat;
  const taal = args.taal ?? instellingen.taal;

  const labels = await maakLabels(args.soort, args.codes);
  const inhoud =
    taal === "zpl"
      ? naarZpl(labels, formaat, aantal)
      : naarHtml(labels, formaat, aantal);

  if (args.vastleggen !== false) {
    await legPrintVast({
      soort: args.soort,
      objectIds: labels.map((l) => l.objectId),
      aantal,
      formaat: formaat.naam,
      door: args.door ?? null,
    });
  }

  return {
    taal,
    mime: taal === "zpl" ? "text/plain; charset=utf-8" : "text/html; charset=utf-8",
    bestandsnaam: bestandsnaam(args.soort, taal),
    inhoud,
    aantalLabels: labels.length * aantal,
  };
}
