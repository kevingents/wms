import { query, queryOne } from "./db";

/**
 * Instellingen-store.
 *
 * Huisregel: configuratie hoort in de tool, niet in Vercel. Alleen echte
 * secrets (DATABASE_URL, SESSION_SECRET, ADMIN_TOKEN) staan in de environment;
 * al het instelbare staat hier in `wms.settings` en is te bewerken via de kaart
 * in /instellingen. Zo kan het magazijn drempels aanpassen zonder redeploy.
 *
 * Elke instelling staat één keer in DEFAULTS beschreven — die lijst is meteen
 * de bron voor de UI, dus een nieuwe instelling toevoegen is één regel hier.
 */

export type InstellingType = "getal" | "tekst" | "schakelaar" | "lijst";

export interface InstellingDefinitie {
  key: string;
  label: string;
  uitleg: string;
  type: InstellingType;
  groep:
    | "Magazijn"
    | "Inslag"
    | "Picken"
    | "Inpakken"
    | "Aanvullen"
    | "Tellen"
    | "Financieel"
    | "Verzenden"
    | "Labels"
    | "Bewaking"
    | "Shadow-fase"
    | "Scannen";
  standaard: unknown;
}

export const INSTELLINGEN: InstellingDefinitie[] = [
  {
    key: "magazijn.naam",
    label: "Magazijnnaam",
    uitleg: "Wat er in de kop van de app staat. Handig bij een tweede locatie.",
    type: "tekst",
    groep: "Magazijn",
    standaard: "GENTS Magazijn",
  },
  {
    key: "magazijn.zones",
    label: "Zones",
    uitleg:
      "Zones in looprichting. Bepaalt de volgorde van nieuwe locaties en straks de pickroute.",
    type: "lijst",
    groep: "Magazijn",
    standaard: ["A", "B", "C", "BULK", "EXPEDITIE"],
  },
  {
    key: "magazijn.locatie_patroon",
    label: "Patroon locatiecode",
    uitleg:
      "Reguliere expressie waaraan een nieuwe locatiecode moet voldoen. Leeg = alles toegestaan.",
    type: "tekst",
    groep: "Magazijn",
    standaard: "^[A-Z]{1,4}(-\\d{1,3}){0,3}$",
  },
  {
    key: "inslag.startlocatie",
    label: "Wachtlocatie beginvoorraad",
    uitleg:
      "Waar de beginvoorraad uit SRS naartoe gaat zolang de echte plek onbekend is. Vanaf hier verhuist de vloer scannend naar echte vakken.",
    type: "tekst",
    groep: "Inslag",
    standaard: "ONBEKEND",
  },
  {
    key: "inslag.standaard_aantal",
    label: "Standaard aantal per scan",
    uitleg:
      "Hoeveel er per artikelscan geboekt wordt bij snelle inslag. Zet op 1 voor stuksgoed; hoger als je per doos inboekt.",
    type: "getal",
    groep: "Inslag",
    standaard: 1,
  },
  {
    key: "picken.bakken_per_kar",
    label: "Bakken per kar",
    uitleg:
      "Hoeveel orders er maximaal in één pickronde passen — één bak per order. Bepaalt hoe groot een batch mag worden.",
    type: "getal",
    groep: "Picken",
    standaard: 12,
  },
  {
    key: "picken.expeditie_locatie",
    label: "Expeditielocatie",
    uitleg:
      "Waar gepikte goederen naartoe geboekt worden. Ze blijven daar in het grootboek staan tot de opdracht verzonden wordt, zodat een doos op de kade vindbaar blijft.",
    type: "tekst",
    groep: "Picken",
    standaard: "EXPEDITIE",
  },
  {
    key: "picken.scan_locatie_verplicht",
    label: "Locatie scannen verplicht",
    uitleg:
      "Dwingt de picker de locatie te scannen voordat hij mag bevestigen. Aan = minder misgrepen bij naast elkaar liggende vakken, uit = sneller.",
    type: "schakelaar",
    groep: "Picken",
    standaard: true,
  },
  {
    key: "picken.scan_artikel_verplicht",
    label: "Artikel scannen verplicht",
    uitleg:
      "Idem voor het artikel zelf. Zet dit uit als te veel artikelen nog geen barcode hebben.",
    type: "schakelaar",
    groep: "Picken",
    standaard: true,
  },
  {
    key: "inpakken.controle_verplicht",
    label: "Scan-controle bij inpakken",
    uitleg:
      "Dwingt de inpakker elk artikel te scannen voordat de doos dicht mag. Dit is de laatste kans om een mispick te vangen; wie het uitzet, betaalt het terug in retouren.",
    type: "schakelaar",
    groep: "Inpakken",
    standaard: true,
  },
  {
    key: "inpakken.standaard_vervoerder",
    label: "Standaard vervoerder",
    uitleg: "Wordt voorgevuld bij het inpakken. Per zending nog aan te passen.",
    type: "tekst",
    groep: "Inpakken",
    standaard: "DHL",
  },
  {
    key: "tellen.per_dag",
    label: "Cyclustellingen per dag",
    uitleg:
      "Hoeveel vakken er dagelijks automatisch ingepland worden om te tellen. Drukke vakken komen vaker aan de beurt dan stille.",
    type: "getal",
    groep: "Tellen",
    standaard: 10,
  },
  {
    key: "aanvullen.minimum_per_regel",
    label: "Minimum per aanvulregel",
    uitleg:
      "Regels waar minder dan dit aantal aan toegewezen wordt, komen niet op de looplijst. Voorkomt rondes waarin je voor losse stuks het hele magazijn doorloopt.",
    type: "getal",
    groep: "Aanvullen",
    standaard: 1,
  },
  {
    key: "tellen.verschil_drempel",
    label: "Drempel telverschil",
    uitleg:
      "Vanaf dit verschil (in stuks) wordt een telling gemarkeerd voor controle door een teamleider.",
    type: "getal",
    groep: "Tellen",
    standaard: 3,
  },
  {
    key: "tellen.blindtellen",
    label: "Blind tellen",
    uitleg:
      "Verbergt het verwachte aantal tijdens het tellen. Aan = betrouwbaardere tellingen, uit = sneller.",
    type: "schakelaar",
    groep: "Tellen",
    standaard: true,
  },
  {
    key: "scannen.bevestig_boven",
    label: "Extra bevestiging vanaf aantal",
    uitleg:
      "Boven dit aantal vraagt de app om een extra bevestiging. Vangt typefouten op de aantal-toets af.",
    type: "getal",
    groep: "Scannen",
    standaard: 25,
  },
  {
    key: "scannen.geluid",
    label: "Piep bij succesvolle scan",
    uitleg: "Hoorbare bevestiging — handig met gehoorbescherming of veel omgevingsgeluid.",
    type: "schakelaar",
    groep: "Scannen",
    standaard: true,
  },
  {
    key: "financieel.gl_voorraad",
    label: "Grootboek — Voorraad",
    uitleg:
      "Balansrekening waarop de voorraadwaarde staat. Zolang dit leeg is worden er geen journaalposten klaargezet; de waardering loopt wel gewoon door.",
    type: "tekst",
    groep: "Financieel",
    standaard: "",
  },
  {
    key: "financieel.gl_te_ontvangen",
    label: "Grootboek — Nog te ontvangen facturen",
    uitleg:
      "Tegenrekening bij ontvangst. De goederen zijn binnen, de factuur nog niet — dat verschil hoort zichtbaar te zijn.",
    type: "tekst",
    groep: "Financieel",
    standaard: "",
  },
  {
    key: "financieel.gl_kostprijs_verkopen",
    label: "Grootboek — Kostprijs verkopen",
    uitleg: "Kostenrekening waarop uitgaande voorraad wordt geboekt.",
    type: "tekst",
    groep: "Financieel",
    standaard: "",
  },
  {
    key: "financieel.gl_voorraadverschil",
    label: "Grootboek — Voorraadverschillen",
    uitleg:
      "Waar telverschillen en afschrijvingen heen gaan. Een aparte rekening, want dit is precies het bedrag dat je wilt zien dalen.",
    type: "tekst",
    groep: "Financieel",
    standaard: "",
  },
  {
    key: "verzenden.aanbieder",
    label: "Verzendaanbieder",
    uitleg:
      "Wie het label levert: sendcloud, dhl of geen. Bij 'geen' vul je het trackingnummer met de hand in.",
    type: "tekst",
    groep: "Verzenden",
    standaard: "geen",
  },
  {
    key: "verzenden.afzender",
    label: "Afzendernaam op het label",
    uitleg: "Wat de klant als afzender ziet.",
    type: "tekst",
    groep: "Verzenden",
    standaard: "GENTS Herenmode",
  },
  {
    key: "labels.formaat",
    label: "Labelformaat",
    uitleg:
      "Welk etiket in de printer zit. Bepaalt de afmetingen van de gegenereerde labels.",
    type: "tekst",
    groep: "Labels",
    standaard: "50x25",
  },
  {
    key: "labels.printer_taal",
    label: "Printertaal",
    uitleg:
      "zpl voor een Zebra-labelprinter, pdf om af te drukken op een gewone printer.",
    type: "tekst",
    groep: "Labels",
    standaard: "zpl",
  },
  {
    key: "bewaking.pick_uren_alarm",
    label: "Alarm bij pickwerk ouder dan (uren)",
    uitleg:
      "Blijft er werk langer dan dit liggen, dan komt er een signaal. Werk dat niemand meer ziet is hoe achterstanden ontstaan.",
    type: "getal",
    groep: "Bewaking",
    standaard: 24,
  },
  {
    key: "bewaking.email",
    label: "Signalen mailen naar",
    uitleg:
      "Adres dat een bericht krijgt bij urgente signalen. Leeg = alleen in het scherm.",
    type: "tekst",
    groep: "Bewaking",
    standaard: "",
  },
  {
    key: "shadow.actief",
    label: "Shadow-vergelijking actief",
    uitleg:
      "Vergelijkt nachtelijk de WMS-voorraad met SRS. Zet dit uit pas ná de cutover.",
    type: "schakelaar",
    groep: "Shadow-fase",
    standaard: true,
  },
  {
    key: "shadow.diff_alarm",
    label: "Alarmdrempel afwijking",
    uitleg:
      "Aantal SKU's met verschil waarboven de dagelijkse vergelijking als 'niet in orde' geldt.",
    type: "getal",
    groep: "Shadow-fase",
    standaard: 10,
  },
];

const STANDAARDEN: Record<string, unknown> = Object.fromEntries(
  INSTELLINGEN.map((i) => [i.key, i.standaard])
);

/** Alle instellingen, met standaarden voor wat nog nooit is opgeslagen. */
export async function alleInstellingen(): Promise<Record<string, unknown>> {
  const rijen = await query<{ key: string; value: unknown }>(
    `SELECT key, value FROM wms.settings`
  );
  const opgeslagen = Object.fromEntries(rijen.map((r) => [r.key, r.value]));
  return { ...STANDAARDEN, ...opgeslagen };
}

export async function instelling<T = unknown>(key: string): Promise<T> {
  const rij = await queryOne<{ value: T }>(
    `SELECT value FROM wms.settings WHERE key = $1`,
    [key]
  );
  return (rij ? rij.value : (STANDAARDEN[key] as T)) as T;
}

export async function zetInstelling(
  key: string,
  waarde: unknown,
  door: string | null
): Promise<void> {
  if (!(key in STANDAARDEN)) {
    throw new Error(`Onbekende instelling: ${key}`);
  }
  await query(
    `INSERT INTO wms.settings (key, value, updated_by)
     VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE
       SET value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
    [key, JSON.stringify(waarde), door]
  );
}
