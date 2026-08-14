import { query, queryOne, BoekingsFout } from "./db";
import { maakPickOpdracht, pickOpdracht, pickRegels, type PickOpdracht } from "./picken";

/**
 * Koppeling met de portal.
 *
 * ROLVERDELING
 * ------------
 * De portal is het brein: herverdeling, replenishment, forecast en inkoop
 * bepalen daar wát er moet gebeuren, met verkoopsnelheid, ideaalvoorraad en
 * al het andere dat het WMS niet weet en niet hoeft te weten.
 *
 * Het WMS zijn de handen: waar ligt het, pak het, boek het, meld terug.
 *
 * ÉÉN DEUR, NIET ÉÉN PER REKENMODEL
 * ---------------------------------
 * Alle rekenmodellen leveren werk af via hetzelfde eindpunt met dezelfde vorm.
 * Een nieuw model in de portal vraagt geen nieuwe koppeling hier — alleen een
 * andere `bron`. Dat is het verschil tussen een systeem dat meegroeit en een
 * systeem waar elke uitbreiding een integratieproject wordt.
 *
 * WAT HET WMS TERUGGEEFT
 * ----------------------
 * Niet alleen "ontvangen", maar meteen wat er van te maken valt: per regel
 * hoeveel er toegewezen kon worden en hoeveel niet. Een adviesmodel dat vraagt
 * om vijf stuks en er twee kan krijgen, wil dat weten vóórdat het de winkel
 * belooft dat er vijf aankomen.
 */

export type KoppelBron =
  | "herverdeling"
  | "aanvulling"
  | "forecast"
  | "weborder"
  | "transfer"
  | "inkoop"
  | "handmatig";

const GELDIGE_BRONNEN: KoppelBron[] = [
  "herverdeling",
  "aanvulling",
  "forecast",
  "weborder",
  "transfer",
  "inkoop",
  "handmatig",
];

export interface OpdrachtVerzoek {
  bron: KoppelBron;
  ref: string;
  bestemming?: string | null;
  prioriteit?: number;
  notitie?: string | null;
  callbackUrl?: string | null;
  payload?: unknown;
  regels: { sku: string; aantal: number }[];
}

export interface OpdrachtAntwoord {
  code: string;
  id: number;
  status: string;
  regels: {
    sku: string;
    gevraagd: number;
    toegewezen: number;
    tekort: number;
    locaties: string[];
  }[];
  totaalGevraagd: number;
  totaalToegewezen: number;
  totaalTekort: number;
  nieuw: boolean;
}

/** Valideert het verzoek en geeft een nette foutmelding, geen stacktrace. */
export function leesVerzoek(body: unknown): OpdrachtVerzoek {
  const b = (body ?? {}) as Record<string, unknown>;

  const bron = String(b.bron || "").trim() as KoppelBron;
  if (!GELDIGE_BRONNEN.includes(bron)) {
    throw new BoekingsFout(
      `Onbekende bron "${bron}". Gebruik een van: ${GELDIGE_BRONNEN.join(", ")}.`,
      "ongeldige_bron"
    );
  }

  const ref = String(b.ref || "").trim();
  if (!ref) {
    throw new BoekingsFout(
      "`ref` is verplicht — daarmee blijft opnieuw versturen veilig.",
      "geen_ref"
    );
  }

  const ruweRegels = Array.isArray(b.regels) ? b.regels : [];
  const regels = ruweRegels
    .map((r) => {
      const rr = (r ?? {}) as Record<string, unknown>;
      return { sku: String(rr.sku || "").trim(), aantal: Math.floor(Number(rr.aantal)) };
    })
    .filter((r) => r.sku && Number.isInteger(r.aantal) && r.aantal > 0);

  if (regels.length === 0) {
    throw new BoekingsFout(
      "Geen bruikbare regels. Elke regel heeft een `sku` en een positief `aantal`.",
      "geen_regels"
    );
  }

  const callbackUrl = b.callbackUrl ? String(b.callbackUrl).trim() : null;
  if (callbackUrl && !/^https:\/\//i.test(callbackUrl)) {
    throw new BoekingsFout("callbackUrl moet https zijn.", "onveilige_callback");
  }

  return {
    bron,
    ref,
    bestemming: b.bestemming ? String(b.bestemming).trim() : null,
    prioriteit: Number(b.prioriteit ?? 0) || 0,
    notitie: b.notitie ? String(b.notitie) : null,
    callbackUrl,
    payload: b.payload ?? null,
    regels,
  };
}

/**
 * Neemt werk aan van de portal. Idempotent op (bron, ref): opnieuw versturen
 * geeft de bestaande opdracht terug in plaats van een tweede ronde te maken.
 */
export async function neemOpdrachtAan(
  verzoek: OpdrachtVerzoek
): Promise<OpdrachtAntwoord> {
  const bestaand = await queryOne<{ id: number }>(
    `SELECT id FROM wms.pick_orders WHERE bron = $1 AND bron_ref = $2`,
    [verzoek.bron, verzoek.ref]
  );

  let opdrachtId: number;
  let nieuw = false;

  if (bestaand) {
    opdrachtId = bestaand.id;
  } else {
    const gemaakt = await maakPickOpdracht({
      bron: verzoek.bron as "weborder" | "transfer" | "handmatig",
      bronRef: verzoek.ref,
      bestemming: verzoek.bestemming,
      prioriteit: verzoek.prioriteit,
      note: verzoek.notitie,
      door: `portal:${verzoek.bron}`,
      regels: verzoek.regels,
    });
    if (!gemaakt) {
      /* Race met een gelijktijdig verzoek: de ander won, die geven we terug. */
      const alsnog = await queryOne<{ id: number }>(
        `SELECT id FROM wms.pick_orders WHERE bron = $1 AND bron_ref = $2`,
        [verzoek.bron, verzoek.ref]
      );
      if (!alsnog) throw new BoekingsFout("Opdracht niet aangemaakt.", "mislukt");
      opdrachtId = alsnog.id;
    } else {
      opdrachtId = gemaakt.id;
      nieuw = true;
      await query(
        `UPDATE wms.pick_orders SET callback_url = $2, bron_payload = $3::jsonb
          WHERE id = $1`,
        [
          opdrachtId,
          verzoek.callbackUrl,
          verzoek.payload == null ? null : JSON.stringify(verzoek.payload),
        ]
      );
    }
  }

  return { ...(await opdrachtStand(opdrachtId)), nieuw };
}

/** De stand van zaken van één opdracht, in de vorm die de portal verwacht. */
export async function opdrachtStand(
  id: number
): Promise<Omit<OpdrachtAntwoord, "nieuw">> {
  const opdracht = await pickOpdracht(id);
  if (!opdracht) throw new BoekingsFout("Opdracht bestaat niet.", "onbekend");

  const regels = await pickRegels(id);

  /* Regels zijn per (sku × locatie) gesplitst; de portal denkt in sku's. Dus
     rollen we terug op sku en geven de locaties als detail mee. */
  const perSku = new Map<
    string,
    { gevraagd: number; toegewezen: number; tekort: number; locaties: string[] }
  >();

  for (const r of regels) {
    const huidig =
      perSku.get(r.sku) ?? { gevraagd: 0, toegewezen: 0, tekort: 0, locaties: [] };
    huidig.gevraagd += r.gevraagd;
    if (r.location_id) {
      huidig.toegewezen += r.gevraagd;
      if (r.location_code && !huidig.locaties.includes(r.location_code)) {
        huidig.locaties.push(r.location_code);
      }
    } else {
      huidig.tekort += r.gevraagd;
    }
    perSku.set(r.sku, huidig);
  }

  const lijst = [...perSku.entries()].map(([sku, v]) => ({ sku, ...v }));

  return {
    code: opdracht.code,
    id: opdracht.id,
    status: opdracht.status,
    regels: lijst,
    totaalGevraagd: lijst.reduce((s, r) => s + r.gevraagd, 0),
    totaalToegewezen: lijst.reduce((s, r) => s + r.toegewezen, 0),
    totaalTekort: lijst.reduce((s, r) => s + r.tekort, 0),
  };
}

export async function opdrachtStandOpRef(
  bron: string,
  ref: string
): Promise<Omit<OpdrachtAntwoord, "nieuw"> | null> {
  const rij = await queryOne<{ id: number }>(
    `SELECT id FROM wms.pick_orders WHERE bron = $1 AND bron_ref = $2`,
    [bron, ref]
  );
  return rij ? opdrachtStand(rij.id) : null;
}

/* ── Terugmelden ───────────────────────────────────────────────────────────── */

/**
 * Zet een gebeurtenis in de uitgaande wachtrij. Bewust geen directe HTTP-call
 * vanuit de boeking: als de portal even weg is mag dat de magazijnvloer niet
 * stilleggen. De gebeurtenis staat vast, de bezorging volgt.
 */
export async function meldTerug(args: {
  soort: "gepikt" | "verzonden" | "tekort";
  pickOrderId: number;
}): Promise<void> {
  const opdracht = await queryOne<{ callback_url: string | null; bron: string; bron_ref: string }>(
    `SELECT callback_url, bron, bron_ref FROM wms.pick_orders WHERE id = $1`,
    [args.pickOrderId]
  );
  if (!opdracht) return;

  const stand = await opdrachtStand(args.pickOrderId);
  const regels = await pickRegels(args.pickOrderId);

  const payload = {
    soort: args.soort,
    bron: opdracht.bron,
    ref: opdracht.bron_ref,
    code: stand.code,
    status: stand.status,
    gevraagd: stand.totaalGevraagd,
    /* Wat er daadwerkelijk gepikt is — niet wat er toegewezen was. Dat verschil
       is precies wat een adviesmodel moet weten om beter te worden. */
    gepikt: regels.reduce((s, r) => s + r.gepikt, 0),
    regels: regels.map((r) => ({
      sku: r.sku,
      gevraagd: r.gevraagd,
      gepikt: r.gepikt,
      locatie: r.location_code,
      status: r.status,
    })),
  };

  await query(
    `INSERT INTO wms.koppeling_uitgaand (soort, pick_order_id, doel_url, payload, status)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [
      args.soort,
      args.pickOrderId,
      opdracht.callback_url,
      JSON.stringify(payload),
      /* Zonder callback bewaren we de gebeurtenis wel, maar sturen we niets.
         De portal kan 'm alsnog ophalen; en het spoor blijft compleet. */
      opdracht.callback_url ? "wachtend" : "overgeslagen",
    ]
  );
}

export interface AfleverResultaat {
  verzonden: number;
  mislukt: number;
  over: number;
}

/** Werkt de uitgaande wachtrij af. Wordt door de cron aangeroepen. */
export async function leegWachtrij(maximum = 50): Promise<AfleverResultaat> {
  const items = await query<{
    id: number;
    doel_url: string;
    payload: unknown;
    pogingen: number;
  }>(
    `SELECT id, doel_url, payload, pogingen
       FROM wms.koppeling_uitgaand
      WHERE status = 'wachtend' AND doel_url IS NOT NULL AND pogingen < 6
      ORDER BY created_at
      LIMIT $1`,
    [maximum]
  );

  let verzonden = 0;
  let mislukt = 0;

  for (const item of items) {
    try {
      const res = await fetch(item.doel_url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.KOPPELING_SECRET
            ? { authorization: `Bearer ${process.env.KOPPELING_SECRET}` }
            : {}),
        },
        body: JSON.stringify(item.payload),
      });

      if (res.ok) {
        await query(
          `UPDATE wms.koppeling_uitgaand
              SET status = 'verzonden', verzonden_at = now(), pogingen = pogingen + 1
            WHERE id = $1`,
          [item.id]
        );
        verzonden += 1;
        continue;
      }

      /* 4xx: de portal weigert dit inhoudelijk, nog eens sturen helpt niet. */
      const definitief = res.status >= 400 && res.status < 500;
      await query(
        `UPDATE wms.koppeling_uitgaand
            SET status = $2, pogingen = pogingen + 1, laatste_fout = $3
          WHERE id = $1`,
        [item.id, definitief ? "mislukt" : "wachtend", `HTTP ${res.status}`]
      );
      mislukt += 1;
    } catch (err) {
      await query(
        `UPDATE wms.koppeling_uitgaand
            SET pogingen = pogingen + 1, laatste_fout = $2
          WHERE id = $1`,
        [item.id, String((err as Error).message).slice(0, 300)]
      );
      mislukt += 1;
    }
  }

  const rest = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM wms.koppeling_uitgaand WHERE status = 'wachtend'`
  );

  return { verzonden, mislukt, over: Number(rest?.n ?? 0) };
}

export type { PickOpdracht };
