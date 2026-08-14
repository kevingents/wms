import { query, queryOne, BoekingsFout } from "./db";
import { backendJson, backendBase } from "./backend";
import { beginvoorraadGeladen } from "./inslag";

/**
 * Bin-locaties uit SRS overnemen.
 *
 * SRS exporteert nachtelijk `voorraadlocaties_*.csv.gz` naar de SFTP met per
 * regel: filiaal, locatiecode, sku, aantal, laatste inventarisatie, geblokkeerd.
 * storegents importeert dat al en serveert het via /api/admin/voorraad-locaties.
 *
 * Dát is de betere go-live: in plaats van 47.000 stuks op één wachtlocatie te
 * dumpen zetten we ze meteen op de vakken waar ze volgens SRS liggen. Het
 * magazijn hoeft dan niet maandenlang te herindelen — alleen te controleren.
 *
 * De wachtlocatie blijft bestaan als vangnet: sku's die SRS wél in voorraad
 * heeft maar zonder locatie, komen daar terecht.
 */

export interface SrsLocatieRij {
  filiaalNummer: string;
  store: string;
  locatie: string;
  sku: string;
  aantal: number;
  lastInventarisation: string;
  geblokkeerd: boolean;
}

interface FiliaalSamenvatting {
  filiaalNummer: string;
  store: string;
  locaties: number;
  totalAantal: number;
  geblokkeerd: number;
}

interface LocatieAntwoord {
  success?: boolean;
  empty?: boolean;
  generatedAt?: string;
  sourceFile?: string;
  count?: number;
  offset?: number;
  limit?: number;
  rows?: SrsLocatieRij[];
  truncated?: boolean;
  totalRows?: number;
  summary?: { filialen?: FiliaalSamenvatting[] };
  message?: string;
}

const PAGINA = 5000;
const MAX_PAGINAS = 20;

async function vraagStoregents(pad: string): Promise<LocatieAntwoord> {
  const { ok, status, data } = await backendJson<LocatieAntwoord>(
    `api/admin/voorraad-locaties${pad}`,
    { method: "GET" },
    true
  );
  if (!ok || !data?.success) {
    throw new BoekingsFout(
      data?.message ||
        (status === 401
          ? "storegents weigert de ADMIN_TOKEN. Controleer of de waarde in dit project gelijk is aan die van storegents."
          : `storegents gaf status ${status} op de locatie-opvraag.`),
      "backend_fout"
    );
  }
  return data;
}

export interface SrsLocatieBron {
  rijen: SrsLocatieRij[];
  generatedAt: string | null;
  bron: string | null;
  /** Wat de samenvatting zegt dat er zou moeten zijn — los van wat we kregen. */
  verwachteRegels: number;
  verwachteStuks: number;
  store: string | null;
  volledig: boolean;
}

/**
 * Haalt de locatieregels van één filiaal op.
 *
 * Eerst de samenvatting opvragen (die werkt op élke versie van het endpoint en
 * geeft per filiaal het aantal regels), daarna pas de regels zelf. Zo weten we
 * altijd of wat we terugkrijgen compleet is — en kunnen we het verschil tussen
 * "SRS kent geen locaties voor het magazijn" en "het endpoint levert ze niet
 * uit" benoemen. Dat scheelt een middag zoeken.
 *
 * Filteren gebeurt op winkelnaam en niet op `branchId`: dat eerste kent élke
 * versie van het endpoint. `branchId` en de paginering gaan wel mee, maar een
 * oudere versie negeert die gewoon.
 */
export async function haalSrsLocaties(branchId = "99"): Promise<SrsLocatieBron> {
  if (!backendBase()) {
    throw new BoekingsFout(
      "BACKEND_API_BASE ontbreekt — de SRS-locaties kunnen niet opgehaald worden.",
      "geen_backend"
    );
  }
  if (!process.env.ADMIN_TOKEN) {
    throw new BoekingsFout(
      "ADMIN_TOKEN ontbreekt in de environment — zonder die sleutel geeft storegents geen locaties.",
      "geen_token"
    );
  }

  /* ── 1. Wat zegt de samenvatting dat er is? ─────────────────────────────── */
  const overzicht = await vraagStoregents("");

  if (overzicht.empty) {
    throw new BoekingsFout(
      "storegents heeft nog geen locatie-snapshot. Draai eerst /api/cron/srs-voorraad-import daar.",
      "geen_snapshot"
    );
  }

  const filialen = overzicht.summary?.filialen ?? [];
  const filiaal = filialen.find((f) => String(f.filiaalNummer) === branchId);

  if (!filiaal || filiaal.locaties === 0) {
    const bekend = filialen
      .slice(0, 8)
      .map((f) => `${f.filiaalNummer} (${f.locaties})`)
      .join(", ");
    throw new BoekingsFout(
      `SRS exporteert geen bin-locaties voor filiaal ${branchId}. ` +
        (filialen.length
          ? `Wel voor: ${bekend}${filialen.length > 8 ? ", …" : ""}. Het magazijn zit dus niet in de locatie-export van SRS.`
          : "De snapshot bevat helemaal geen filialen."),
      "geen_locaties_voor_filiaal"
    );
  }

  /* ── 2. De regels zelf, pagina voor pagina ──────────────────────────────── */
  const rijen: SrsLocatieRij[] = [];
  let generatedAt: string | null = overzicht.generatedAt ?? null;
  let bron: string | null = overzicht.sourceFile ?? null;
  let offset = 0;
  let paginering = true;

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const data = await vraagStoregents(
      `?store=${encodeURIComponent(filiaal.store)}` +
        `&branchId=${encodeURIComponent(branchId)}` +
        `&limit=${PAGINA}&offset=${offset}`
    );

    generatedAt = data.generatedAt ?? generatedAt;
    bron = data.sourceFile ?? bron;

    const paginaRijen = Array.isArray(data.rows) ? data.rows : [];
    rijen.push(...paginaRijen.filter((r) => String(r.filiaalNummer) === branchId));

    if (!data.truncated || paginaRijen.length === 0) break;

    /* Een oudere versie kapt af zonder offset te kennen. Doorvragen zou dan
       eindeloos dezelfde eerste pagina opleveren. */
    if (typeof data.offset !== "number") {
      paginering = false;
      break;
    }

    offset += paginaRijen.length;
  }

  const volledig = paginering && rijen.length >= filiaal.locaties;

  return {
    rijen,
    generatedAt,
    bron,
    verwachteRegels: filiaal.locaties,
    verwachteStuks: filiaal.totalAantal,
    store: filiaal.store,
    volledig,
  };
}

/* ── Importeren ────────────────────────────────────────────────────────────── */

/** Bouwt één INSERT met meerdere VALUES-rijen. */
function meervoudigeWaarden(aantalRijen: number, kolommen: number, startIndex = 1): string {
  const groepen: string[] = [];
  let i = startIndex;
  for (let r = 0; r < aantalRijen; r++) {
    const plaatshouders = Array.from({ length: kolommen }, () => `$${i++}`);
    groepen.push(`(${plaatshouders.join(", ")})`);
  }
  return groepen.join(", ");
}

export interface SrsImportResultaat {
  generatedAt: string | null;
  bron: string | null;
  locaties: number;
  geblokkeerd: number;
  regels: number;
  stuks: number;
}

/**
 * Maakt de locaties aan en boekt de voorraad erop als startsaldo.
 *
 * In batches, want de HTTP-driver doet één statement per call: 4.000 losse
 * inserts zouden de functie-timeout ruim overschrijden. Met 500 rijen per
 * statement zijn het er een handvol.
 *
 * Eenmalig, net als de andere beginvoorraad-route: een tweede import zou de
 * voorraad verdubbelen.
 */
export async function importeerSrsLocaties(
  door: string | null,
  branchId = "99"
): Promise<SrsImportResultaat> {
  if (await beginvoorraadGeladen()) {
    throw new BoekingsFout(
      "Er staat al een beginvoorraad. Corrigeer verschillen met tellingen, niet met een tweede import.",
      "al_geladen"
    );
  }

  const { rijen, generatedAt, bron, verwachteRegels, volledig } =
    await haalSrsLocaties(branchId);

  if (rijen.length === 0) {
    throw new BoekingsFout(
      `SRS kent ${verwachteRegels} locatieregels voor filiaal ${branchId}, maar er kwam er niet één door. Controleer /api/admin/voorraad-locaties in storegents.`,
      "geen_data"
    );
  }

  /* Half importeren is erger dan niet importeren: de totalen kloppen dan niet
     en niemand ziet waarom. Liever weigeren met een aanwijzing. */
  if (!volledig) {
    throw new BoekingsFout(
      `Er kwamen ${rijen.length} van de ${verwachteRegels} locatieregels door — storegents kapt af zonder paginering. ` +
        "Merge en deploy storegents#416 eerst; anders zou het WMS een onvolledige voorraad boeken.",
      "onvolledig"
    );
  }

  /* ── Locaties ─────────────────────────────────────────────────────────────
     Eén locatie kan meerdere sku's herbergen; we houden per code bij of hij
     ergens geblokkeerd staat. `sort_order` volgt de alfabetische code — dat is
     een deterministische startvolgorde, geen echte looproute. Die stelt het
     magazijn later bij op /locaties; daar is `sort_order` voor. */
  const perCode = new Map<string, { geblokkeerd: boolean }>();
  for (const r of rijen) {
    const code = r.locatie.trim().toUpperCase();
    if (!code) continue;
    const bestaand = perCode.get(code);
    perCode.set(code, { geblokkeerd: (bestaand?.geblokkeerd ?? false) || r.geblokkeerd });
  }

  const codes = [...perCode.keys()].sort();
  const BATCH = 500;

  for (let i = 0; i < codes.length; i += BATCH) {
    const stuk = codes.slice(i, i + BATCH);
    const params: unknown[] = [];
    stuk.forEach((code, j) => {
      const info = perCode.get(code)!;
      params.push(
        code,
        `SRS-locatie ${code}`,
        code.split(/[-.\s]/)[0] || null,
        "pick",
        (i + j + 1) * 10,
        !info.geblokkeerd,
        info.geblokkeerd ? "Geblokkeerd in SRS" : null
      );
    });
    await query(
      `INSERT INTO wms.locations (code, name, zone, kind, sort_order, pickable, note)
       VALUES ${meervoudigeWaarden(stuk.length, 7)}
       ON CONFLICT (code) DO UPDATE SET
         zone = excluded.zone,
         sort_order = excluded.sort_order,
         pickable = excluded.pickable,
         note = excluded.note,
         active = true,
         updated_at = now()`,
      params
    );
  }

  /* ── Voorraad ─────────────────────────────────────────────────────────────
     Per (locatie, sku) één startsaldo-boeking. De idempotency-sleutel bevat de
     SRS-peiling, dus dezelfde import twee keer draaien doet niets. */
  const peiling = (generatedAt || bron || "onbekend").slice(0, 40);
  const teBoeken = rijen.filter((r) => r.sku && r.locatie && Number(r.aantal) > 0);

  let geboekt = 0;
  let stuks = 0;

  for (let i = 0; i < teBoeken.length; i += BATCH) {
    const stuk = teBoeken.slice(i, i + BATCH);
    const params: unknown[] = [];
    for (const r of stuk) {
      const code = r.locatie.trim().toUpperCase();
      params.push(
        r.sku.trim(),
        code,
        Number(r.aantal),
        door,
        `Beginvoorraad SRS ${code}`,
        `startsaldo:srs-loc:${peiling}:${code}:${r.sku.trim()}`
      );
      stuks += Number(r.aantal);
    }

    /* Locatie-id wordt in het statement zelf opgezocht, zodat we geen tweede
       ronde nodig hebben om ids op te halen. De expliciete casts zijn nodig:
       parameters in een VALUES-lijst komen als `unknown` binnen en Postgres
       weigert die zonder type tegen een integer-kolom te zetten. */
    await query(
      `INSERT INTO wms.stock_moves
         (sku, to_location_id, qty, reason, actor_name, note, idempotency_key)
       SELECT v.sku::text, l.id, v.qty::int, 'startsaldo',
              v.actor::text, v.note::text, v.sleutel::text
         FROM (VALUES ${meervoudigeWaarden(stuk.length, 6)})
              AS v(sku, code, qty, actor, note, sleutel)
         JOIN wms.locations l ON l.code = v.code::text
       ON CONFLICT (idempotency_key) DO NOTHING`,
      params
    );
    geboekt += stuk.length;
  }

  const totaal = await queryOne<Record<string, string>>(
    `SELECT coalesce(sum(qty), 0)::text AS stuks FROM wms.stock_levels WHERE qty > 0`
  );

  return {
    generatedAt,
    bron,
    locaties: codes.length,
    geblokkeerd: [...perCode.values()].filter((v) => v.geblokkeerd).length,
    regels: geboekt,
    stuks: Number(totaal?.stuks ?? stuks),
  };
}
