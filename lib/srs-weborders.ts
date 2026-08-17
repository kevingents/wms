import { query, BoekingsFout } from "./db";
import { backendJson, backendBase } from "./backend";

/**
 * Open weborders uit SRS.
 *
 * WAAROM DEZE BRON NAAST DE CORE
 * ------------------------------
 * `importeerPickwerk()` leest `public.orders.fulfillment_plan` — het planmodel
 * van de nieuwe commerce-core. Dat werkt, maar het draait nog als pilot: er komen
 * veertig tot zestig weborders per dag binnen en daarvan krijgen er nul tot acht
 * een plan. De echte weborder-afhandeling voor het magazijn loopt vandaag nog via
 * SRS.
 *
 * Zolang dat zo is moet het WMS lezen wat SRS toewijst, anders ziet de vloer een
 * fractie van het werk en gebeurt de rest buiten het systeem om. Dat is dezelfde
 * redenering als bij de voorraad: tijdens de schaduwfase volgt het WMS de bron
 * die op dat moment de waarheid is.
 *
 * DUBBELE ORDERS VOORKOMEN
 * ------------------------
 * Een order kan in beide bronnen zitten. Daarom normaliseren we het ordernummer
 * (SRS schrijft `#GSLFJW5G3F`, de core `GSLFJW5G3F`) en gebruiken we hetzelfde
 * `bron_ref` als de core-import. De UNIQUE (bron, bron_ref) op pick_orders doet
 * de rest — welke bron er ook eerst is, er komt één opdracht.
 */

export interface SrsWeborderRegel {
  orderName: string;
  orderId: string;
  location: string;
  store: string;
  sku: string;
  barcode: string;
  productName: string;
  quantity: number;
  date: string;
  ageHours: number;
  isLate: boolean;
}

interface WeborderAntwoord {
  success?: boolean;
  message?: string;
  generatedAt?: string;
  totals?: {
    pipelineTotal?: number;
    pipelineSplit?: { magazijn?: number; showroom?: number; uitlevertafel?: number };
    fetchError?: string | null;
  };
  pipeline?: SrsWeborderRegel[];
}

export interface SrsWeborderBron {
  regels: SrsWeborderRegel[];
  orders: number;
  generatedAt: string | null;
  fetchFout: string | null;
}

/** `#GSLFJW5G3F` en `GSLFJW5G3F` zijn dezelfde order. */
export function normaliseerOrdernummer(waarde: string): string {
  return String(waarde ?? "")
    .trim()
    .replace(/^#+/, "")
    .toUpperCase();
}

/**
 * Haalt de open weborders op die bij het magazijn liggen.
 *
 * Showroom en uitlevertafel vallen af: die staan in dezelfde pipeline-lijst maar
 * zijn andere plekken met eigen mensen, en werk daar op de magazijnlijst zetten
 * levert rondes op die niemand kan lopen.
 */
export async function haalSrsWeborders(): Promise<SrsWeborderBron> {
  if (!backendBase()) {
    throw new BoekingsFout(
      "BACKEND_API_BASE ontbreekt — de SRS-weborders kunnen niet opgehaald worden.",
      "geen_backend"
    );
  }
  if (!process.env.ADMIN_TOKEN) {
    throw new BoekingsFout(
      "ADMIN_TOKEN ontbreekt in de environment — zonder die sleutel geeft storegents geen weborders.",
      "geen_token"
    );
  }

  const { ok, status, data } = await backendJson<WeborderAntwoord>(
    "api/admin/open-weborders-detail",
    { method: "GET" },
    true
  );

  if (!ok || !data?.success) {
    throw new BoekingsFout(
      data?.message ||
        (status === 401
          ? "storegents weigert de ADMIN_TOKEN. Controleer of de waarde gelijk is aan die van storegents."
          : `storegents gaf status ${status} op de weborder-opvraag.`),
      "backend_fout"
    );
  }

  const alles = Array.isArray(data.pipeline) ? data.pipeline : [];
  const regels = alles.filter(
    (r) => String(r.location ?? "").toLowerCase() === "magazijn" && Number(r.quantity) > 0
  );

  const orders = new Set(regels.map((r) => normaliseerOrdernummer(r.orderName))).size;

  return {
    regels,
    orders,
    generatedAt: data.generatedAt ?? null,
    /* SRS is niet altijd bereikbaar; het endpoint meldt dat als `fetchError` en
       geeft dan wat het nog uit z'n cache heeft. Doorgeven, niet verzwijgen —
       een halve lijst die er compleet uitziet, is erger dan geen lijst. */
    fetchFout: data.totals?.fetchError ?? null,
  };
}

/* ── Artikelen herleiden ───────────────────────────────────────────────────── */

/**
 * SRS levert per regel een sku én een barcode. Welke van de twee bruikbaar is
 * verschilt per artikel, dus we proberen beide in één keer: de barcode is de
 * betrouwbaarste sleutel (dat is wat de scanner leest), de sku de terugval.
 *
 * Eén query voor de hele lijst in plaats van per regel — bij zestig orders met
 * elk een paar regels zijn dat anders honderden losse vragen.
 */
export async function herleidSkus(
  regels: SrsWeborderRegel[]
): Promise<Map<string, string>> {
  const barcodes = [...new Set(regels.map((r) => String(r.barcode ?? "").trim()).filter(Boolean))];
  const skus = [...new Set(regels.map((r) => String(r.sku ?? "").trim()).filter(Boolean))];

  const gevonden = new Map<string, string>();
  if (barcodes.length === 0 && skus.length === 0) return gevonden;

  const rijen = await query<{ sleutel: string; sku: string }>(
    `SELECT b.barcode AS sleutel, b.sku FROM wms.barcodes b WHERE b.barcode = ANY($1::text[])
     UNION ALL
     SELECT a.sku AS sleutel, a.sku FROM wms.artikelen a WHERE a.sku = ANY($2::text[])`,
    [barcodes, skus]
  );

  for (const r of rijen) gevonden.set(r.sleutel, r.sku);
  return gevonden;
}

export interface SrsWeborderOpdracht {
  ordernummer: string;
  klant: string | null;
  isLate: boolean;
  oudsteUren: number;
  regels: { sku: string; aantal: number }[];
  onbekend: { sku: string; barcode: string; naam: string; aantal: number }[];
}

/**
 * Groepeert de losse SRS-regels tot opdrachten per order.
 *
 * Regels waarvan het artikel niet in de catalogus te vinden is, gaan niet
 * verloren maar komen apart terug. Zo'n order kan wél gepikt worden voor de rest,
 * en de onbekende regel is een melding waar iemand iets mee moet — stil weglaten
 * zou betekenen dat de klant een halve doos krijgt zonder dat iemand het weet.
 */
export async function groepeerTotOpdrachten(
  regels: SrsWeborderRegel[]
): Promise<SrsWeborderOpdracht[]> {
  const skuVoor = await herleidSkus(regels);
  const perOrder = new Map<string, SrsWeborderOpdracht>();

  for (const r of regels) {
    const ordernummer = normaliseerOrdernummer(r.orderName);
    if (!ordernummer) continue;

    let opdracht = perOrder.get(ordernummer);
    if (!opdracht) {
      opdracht = {
        ordernummer,
        klant: null,
        isLate: false,
        oudsteUren: 0,
        regels: [],
        onbekend: [],
      };
      perOrder.set(ordernummer, opdracht);
    }

    opdracht.isLate = opdracht.isLate || Boolean(r.isLate);
    opdracht.oudsteUren = Math.max(opdracht.oudsteUren, Number(r.ageHours) || 0);

    const aantal = Math.floor(Number(r.quantity) || 0);
    if (aantal <= 0) continue;

    const barcode = String(r.barcode ?? "").trim();
    const ruweSku = String(r.sku ?? "").trim();
    const sku = skuVoor.get(barcode) ?? skuVoor.get(ruweSku) ?? null;

    if (!sku) {
      opdracht.onbekend.push({
        sku: ruweSku,
        barcode,
        naam: String(r.productName ?? "").trim(),
        aantal,
      });
      continue;
    }

    /* Dezelfde sku twee keer in één order wordt één regel: anders loopt de
       picker twee keer naar hetzelfde vak. */
    const bestaand = opdracht.regels.find((x) => x.sku === sku);
    if (bestaand) bestaand.aantal += aantal;
    else opdracht.regels.push({ sku, aantal });
  }

  return [...perOrder.values()];
}
