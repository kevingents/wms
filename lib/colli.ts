import { query, queryOne, BoekingsFout } from "./db";
import { boekMutatie, zoekArtikel, zoekLocatie } from "./voorraad";
import { instelling } from "./instellingen";

/**
 * Colli (LPN) en cross-docking.
 *
 * EEN COLLO IS EEN HANDVAT, GEEN TWEEDE VOORRAADADMINISTRATIE
 * -----------------------------------------------------------
 * Een collo is een fysieke drager met een eigen label: doos, pallet,
 * rolcontainer. De winst zit in het aantal handelingen — bij ontvangst scan je
 * één label in plaats van veertig artikelen, en bij inslag verhuist een hele
 * pallet in één beweging naar een vak.
 *
 * De inhoud in `collo_regels` is daarom bewust geen voorraadstand maar een
 * paklijst: wat er volgens de vorige handeling in zit. De waarheid blijft het
 * grootboek. `voegToe()` boekt dus niets — een artikel verhuist niet doordat je
 * het in een doos legt, het ligt al ergens in het magazijn. Pas
 * `verplaatsCollo()` raakt de voorraad aan.
 *
 * Klopt de paklijst niet met wat er werkelijk ligt, dan strandt die
 * verplaatsing op de niet-negatief-check van de saldi. Dat is precies waar het
 * hoort te stranden, en de melding zegt om welke regel het gaat.
 *
 * DEELS GELUKT IS OOK EEN ANTWOORD
 * --------------------------------
 * De HTTP-driver kent geen interactieve transactie, dus een collo van tien
 * regels zijn tien losse boekingen. Faalt regel zeven, dan staan er zes
 * verplaatst en vier niet. Dat verzwijgen is het gevaarlijkste wat we kunnen
 * doen: de vloer denkt dan dat de pallet weg is terwijl er nog wat op de oude
 * plek staat, en dat verschil vind je pas maanden later terug.
 *
 * `verplaatsCollo()` meldt daarom altijd expliciet wat er wél en niet geboekt
 * is, verhangt het collo alleen als álles gelukt is, en schrijft bij een
 * halve verplaatsing een regel in de notitie — zodat de volgende die het label
 * scant het ook nog leest.
 *
 * CROSS-DOCKING
 * -------------
 * Binnengekomen goederen waar al vraag op staat hoeven niet eerst het schap in
 * om er een uur later weer uit gepikt te worden. Dat scheelt twee handelingen
 * per stuk. Het WMS verzint die kans niet zelf: de view `wms.crossdock_kansen`
 * kijkt of er open pickregels op dezelfde sku wachten.
 *
 * Wat er méér binnenkomt dan er gevraagd wordt gaat gewoon het magazijn in.
 * Alles naar de expeditie boeken "omdat het toch al binnen is" laat spullen op
 * de kade staan waar geen zending voor bestaat — dat is hoe een expeditievak
 * dichtslibt.
 */

/* ── Vormen ────────────────────────────────────────────────────────────────── */

export type ColloSoort = "doos" | "pallet" | "rolcontainer" | "zak";
export type ColloStatus = "open" | "gesloten" | "verwerkt" | "vervallen";

export const COLLO_SOORTEN: { waarde: ColloSoort; label: string }[] = [
  { waarde: "doos", label: "Doos" },
  { waarde: "pallet", label: "Pallet" },
  { waarde: "rolcontainer", label: "Rolcontainer" },
  { waarde: "zak", label: "Zak" },
];

export interface Collo {
  id: number;
  code: string;
  soort: ColloSoort;
  status: ColloStatus;
  locatie_id: number | null;
  locatie_code: string | null;
  ontvangst_id: number | null;
  ontvangst_code: string | null;
  zending_id: number | null;
  aangemaakt_door: string | null;
  note: string | null;
  created_at: string;
  gesloten_at: string | null;
  regels: number;
  stuks: number;
}

export interface ColloRegel {
  id: number;
  collo_id: number;
  sku: string;
  aantal: number;
  created_at: string;
  omschrijving: string | null;
  merk: string | null;
  maat: string | null;
  kleur: string | null;
  barcode: string | null;
}

const COLLO_SELECT = `
  SELECT c.*,
         l.code AS locatie_code,
         o.code AS ontvangst_code,
         (SELECT count(*) FROM wms.collo_regels r WHERE r.collo_id = c.id)::int AS regels,
         (SELECT coalesce(sum(r.aantal), 0) FROM wms.collo_regels r
           WHERE r.collo_id = c.id)::int                                        AS stuks
    FROM wms.colli c
    LEFT JOIN wms.locations l ON l.id = c.locatie_id
    LEFT JOIN wms.ontvangsten o ON o.id = c.ontvangst_id`;

/* ── Lezen ─────────────────────────────────────────────────────────────────── */

/** Alles wat nog in omloop is: gevuld wordt of dichtstaat en nog verplaatst moet. */
export async function openColli(): Promise<Collo[]> {
  return query<Collo>(
    `${COLLO_SELECT}
      WHERE c.status IN ('open', 'gesloten')
      ORDER BY c.status, c.created_at DESC`
  );
}

export async function collo(id: number): Promise<Collo | null> {
  return queryOne<Collo>(`${COLLO_SELECT} WHERE c.id = $1`, [id]);
}

/**
 * Op het label. Zoekt bewust ook buiten de open colli: wie een verwerkt collo
 * scant hoort te zien dát het verwerkt is, niet "onbekend label".
 */
export async function zoekCollo(code: string): Promise<Collo | null> {
  const schoon = code.trim();
  if (!schoon) return null;
  return queryOne<Collo>(`${COLLO_SELECT} WHERE upper(c.code) = upper($1)`, [schoon]);
}

export async function colloRegels(id: number): Promise<ColloRegel[]> {
  return query<ColloRegel>(
    `SELECT r.*, a.omschrijving, a.merk, a.maat, a.kleur, a.barcode
       FROM wms.collo_regels r
       LEFT JOIN wms.artikelen a ON a.sku = r.sku
      WHERE r.collo_id = $1
      ORDER BY r.created_at, r.sku`,
    [id]
  );
}

/* ── Aanmaken en vullen ────────────────────────────────────────────────────── */

async function nieuweCode(): Promise<string> {
  const rij = await queryOne<{ n: string }>(`SELECT nextval('wms.collo_nummer')::text AS n`);
  return `C-${String(rij?.n ?? "0").padStart(5, "0")}`;
}

/**
 * Maakt een leeg collo aan.
 *
 * Zonder opgegeven locatie belandt het op de wachtlocatie uit de instellingen.
 * Dat is geen verlegenheidsoplossing maar de eerlijke stand: de goederen zijn
 * binnen, de plek is nog niet bepaald. Een collo zonder locatie zou later niet
 * te verplaatsen zijn, want dan is er geen van-kant om vanaf te boeken.
 */
export async function maakCollo(args: {
  soort?: ColloSoort;
  locatieCode?: string | null;
  ontvangstId?: number | null;
  notitie?: string | null;
  door: string | null;
}): Promise<Collo> {
  const soort = args.soort ?? "doos";
  if (!COLLO_SOORTEN.some((s) => s.waarde === soort)) {
    throw new BoekingsFout(`Onbekende collosoort: ${soort}`, "ongeldige_soort");
  }

  const code =
    args.locatieCode?.trim() ||
    String(await instelling<string>("inslag.startlocatie")) ||
    "ONBEKEND";
  const locatie = await zoekLocatie(code);
  if (!locatie) throw new BoekingsFout(`Onbekende locatie: ${code}`, "geen_locatie");

  const rij = await queryOne<{ id: number }>(
    `INSERT INTO wms.colli (code, soort, locatie_id, ontvangst_id, note, aangemaakt_door)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      await nieuweCode(),
      soort,
      locatie.id,
      args.ontvangstId ?? null,
      args.notitie ?? null,
      args.door,
    ]
  );
  if (!rij) throw new BoekingsFout("Collo niet aangemaakt.");
  return (await collo(rij.id))!;
}

/**
 * Zet een artikel op de paklijst. `code` is een barcode of een sku — dit is een
 * scanveld, en de scanner leest de barcode.
 *
 * Twee keer dezelfde sku telt op in plaats van te weigeren: wie een doos vult
 * pakt dezelfde maat vaak in twee grepen, en dan is optellen wat hij bedoelt.
 */
export async function voegToe(
  colloId: number,
  code: string,
  aantal = 1
): Promise<ColloRegel[]> {
  if (!Number.isInteger(aantal) || aantal <= 0) {
    throw new BoekingsFout("Aantal moet een positief geheel getal zijn.", "ongeldig_aantal");
  }

  const doel = await collo(colloId);
  if (!doel) throw new BoekingsFout("Dit collo bestaat niet.", "onbekend");
  if (doel.status !== "open") {
    throw new BoekingsFout(
      `Collo ${doel.code} staat dicht — open een nieuw collo of maak dit weer open.`,
      "collo_dicht"
    );
  }

  const artikel = await zoekArtikel(code);
  if (!artikel) {
    throw new BoekingsFout(`Onbekend artikel: ${code.trim()}`, "geen_artikel");
  }

  await query(
    `INSERT INTO wms.collo_regels (collo_id, sku, aantal)
     VALUES ($1, $2, $3)
     ON CONFLICT (collo_id, sku)
       DO UPDATE SET aantal = wms.collo_regels.aantal + excluded.aantal`,
    [colloId, artikel.sku, aantal]
  );

  return colloRegels(colloId);
}

/** Haalt een regel weer van de paklijst — voor de misscan. */
export async function verwijderRegel(colloId: number, sku: string): Promise<ColloRegel[]> {
  const doel = await collo(colloId);
  if (!doel) throw new BoekingsFout("Dit collo bestaat niet.", "onbekend");
  if (doel.status !== "open") {
    throw new BoekingsFout("Collo staat dicht — de paklijst ligt vast.", "collo_dicht");
  }
  await query(`DELETE FROM wms.collo_regels WHERE collo_id = $1 AND sku = $2`, [
    colloId,
    sku.trim(),
  ]);
  return colloRegels(colloId);
}

/**
 * Sluit het collo: de paklijst ligt vast en het label mag erop.
 *
 * Een leeg collo sluiten mag niet. Dat levert een label op dat nergens bij
 * hoort, en juist dat label komt later een keer langs met de vraag wat erin zat.
 */
export async function sluitCollo(colloId: number): Promise<Collo> {
  const doel = await collo(colloId);
  if (!doel) throw new BoekingsFout("Dit collo bestaat niet.", "onbekend");
  if (doel.status !== "open") {
    throw new BoekingsFout(`Collo ${doel.code} staat al dicht.`, "collo_dicht");
  }
  if (doel.regels === 0) {
    throw new BoekingsFout(
      "Dit collo is nog leeg — scan eerst wat erin gaat.",
      "collo_leeg"
    );
  }

  await query(
    `UPDATE wms.colli SET status = 'gesloten', gesloten_at = now() WHERE id = $1`,
    [colloId]
  );
  return (await collo(colloId))!;
}

/* ── Verplaatsen ───────────────────────────────────────────────────────────── */

export interface VerplaatsRegelResultaat {
  sku: string;
  aantal: number;
  omschrijving: string | null;
  melding?: string;
}

export interface VerplaatsResultaat {
  collo: Collo;
  van: string | null;
  naar: string;
  geboekt: VerplaatsRegelResultaat[];
  mislukt: VerplaatsRegelResultaat[];
  volledig: boolean;
  melding: string;
}

/**
 * Verplaatst het hele collo in één handeling naar een vak.
 *
 * Dit is waar een collo z'n geld verdient: één scan van het label en één scan
 * van het vak in plaats van veertig losse boekingen. Onder water blijven het
 * wel veertig boekingen — elke regel gaat gewoon door `boekMutatie()`, want het
 * grootboek is per sku en per locatie, niet per doos.
 *
 * Zonder transactie kan het halverwege stuklopen. Daarom boeken we regel voor
 * regel door en verzamelen we beide uitkomsten, in plaats van bij de eerste
 * fout te stoppen: de rest van de doos hóórt op de nieuwe plek te komen. Wat
 * niet lukte staat er nog, en dat is precies wat de melding zegt.
 */
export async function verplaatsCollo(
  colloId: number,
  naarLocatieCode: string,
  opties: {
    actorId?: string | null;
    actorNaam?: string | null;
    idempotencyKey?: string | null;
  } = {}
): Promise<VerplaatsResultaat> {
  const doel = await collo(colloId);
  if (!doel) throw new BoekingsFout("Dit collo bestaat niet.", "onbekend");
  if (doel.status === "verwerkt" || doel.status === "vervallen") {
    throw new BoekingsFout(
      `Collo ${doel.code} is al afgehandeld en kan niet meer verplaatst worden.`,
      "collo_afgehandeld"
    );
  }
  if (!doel.locatie_id) {
    throw new BoekingsFout(
      `Van collo ${doel.code} is niet bekend waar het staat — er is geen locatie om vanaf te boeken.`,
      "geen_locatie"
    );
  }

  const naar = await zoekLocatie(naarLocatieCode);
  if (!naar) {
    throw new BoekingsFout(`Onbekende locatie: ${naarLocatieCode.trim()}`, "geen_locatie");
  }
  if (naar.id === doel.locatie_id) {
    throw new BoekingsFout(
      `Collo ${doel.code} staat al op ${naar.code}.`,
      "zelfde_locatie"
    );
  }

  const regels = await colloRegels(colloId);
  if (regels.length === 0) {
    throw new BoekingsFout(
      "Dit collo is leeg — er valt niets te verplaatsen.",
      "collo_leeg"
    );
  }

  const geboekt: VerplaatsRegelResultaat[] = [];
  const mislukt: VerplaatsRegelResultaat[] = [];

  for (const regel of regels) {
    try {
      await boekMutatie({
        sku: regel.sku,
        vanLocatieId: doel.locatie_id,
        naarLocatieId: naar.id,
        aantal: regel.aantal,
        reden: "verplaatsing",
        refType: "collo",
        refId: doel.code,
        actorId: opties.actorId ?? null,
        actorNaam: opties.actorNaam ?? null,
        notitie: `Collo ${doel.code} verplaatst naar ${naar.code}`,
        idempotencyKey: opties.idempotencyKey
          ? `${opties.idempotencyKey}:${regel.sku}`
          : null,
      });
      geboekt.push({
        sku: regel.sku,
        aantal: regel.aantal,
        omschrijving: regel.omschrijving,
      });
    } catch (err) {
      mislukt.push({
        sku: regel.sku,
        aantal: regel.aantal,
        omschrijving: regel.omschrijving,
        melding:
          err instanceof BoekingsFout
            ? err.message
            : "Onbekende fout bij het boeken van deze regel.",
      });
    }
  }

  const volledig = mislukt.length === 0;
  const van = doel.locatie_code;

  if (volledig) {
    await query(`UPDATE wms.colli SET locatie_id = $2 WHERE id = $1`, [colloId, naar.id]);
  } else {
    /* Het collo blijft administratief op de oude plek staan, want daar ligt nog
       een deel. De notitie is de enige plek waar dit een refresh overleeft. */
    const regel =
      `${new Date().toISOString().slice(0, 16).replace("T", " ")} — ` +
      `deels verplaatst naar ${naar.code}: ${geboekt.length} van ${regels.length} regels. ` +
      `Blijft op ${van}: ${mislukt.map((m) => m.sku).join(", ")}.`;
    await query(
      `UPDATE wms.colli SET note = coalesce(note || E'\n', '') || $2 WHERE id = $1`,
      [colloId, regel]
    );
  }

  const bijgewerkt = (await collo(colloId))!;
  const melding = volledig
    ? `Collo ${doel.code} staat nu op ${naar.code} — ${geboekt.length} regel${
        geboekt.length === 1 ? "" : "s"
      } geboekt.`
    : `Let op: ${geboekt.length} van ${regels.length} regels staan nu op ${naar.code}. ` +
      `De rest ligt nog op ${van} — controleer die regels voordat je verder gaat.`;

  return { collo: bijgewerkt, van, naar: naar.code, geboekt, mislukt, volledig, melding };
}

/* ── Cross-docking ─────────────────────────────────────────────────────────── */

export interface CrossdockKans {
  ontvangst_regel_id: number;
  ontvangst_id: number;
  ontvangst_code: string;
  sku: string;
  verwacht: number;
  ontvangen: number;
  gevraagd_open: number;
  opdrachten: number;
  omschrijving: string | null;
  merk: string | null;
  maat: string | null;
  kleur: string | null;
}

/**
 * Wat komt er binnen waar al vraag op staat?
 *
 * De view kijkt niet naar de status van de ontvangstregel zelf, dus die filteren
 * we hier: een regel die al ingeboekt is, is geen kans meer maar een gemiste.
 */
export async function crossdockKansen(limiet = 50): Promise<CrossdockKans[]> {
  return query<CrossdockKans>(
    `SELECT k.*, a.omschrijving, a.merk, a.maat, a.kleur
       FROM wms.crossdock_kansen k
       JOIN wms.ontvangst_regels r ON r.id = k.ontvangst_regel_id AND r.status = 'open'
       LEFT JOIN wms.artikelen a ON a.sku = k.sku
      ORDER BY k.gevraagd_open DESC, k.sku
      LIMIT $1`,
    [limiet]
  );
}

export interface CrossdockResultaat {
  ontvangstRegelId: number;
  sku: string;
  ontvangen: number;
  naarExpeditie: number;
  naarMagazijn: number;
  expeditieLocatie: string;
  magazijnLocatie: string | null;
  melding: string;
}

/**
 * Boekt een ontvangstregel rechtstreeks naar de expeditielocatie in plaats van
 * naar een schap.
 *
 * Wat er meer binnenkomt dan er open gevraagd wordt gaat alsnog het magazijn in.
 * Alles naar de expeditie duwen zou spullen op de kade neerzetten waar geen
 * zending bij hoort, en dat vak moet juist leeglopen — niet vollopen.
 *
 * De boeking krijgt reden `ontvangst` en niet `pick`: de goederen komen bínnen,
 * ze zijn alleen nooit in een schap geweest. Het cross-dock zit in de notitie en
 * in `ref_type`, zodat later te zien is waarom er voorraad op de expeditie staat
 * zonder dat er een pick aan voorafging.
 */
export async function crossdockNaarExpeditie(args: {
  ontvangstRegelId: number;
  aantal?: number;
  actorId: string;
  actorNaam: string;
  idempotencyKey?: string | null;
}): Promise<CrossdockResultaat> {
  const regel = await queryOne<{
    id: number;
    ontvangst_id: number;
    sku: string;
    verwacht: number;
    status: string;
    code: string;
  }>(
    `SELECT r.id, r.ontvangst_id, r.sku, r.verwacht, r.status, o.code
       FROM wms.ontvangst_regels r
       JOIN wms.ontvangsten o ON o.id = r.ontvangst_id
      WHERE r.id = $1`,
    [args.ontvangstRegelId]
  );
  if (!regel) throw new BoekingsFout("Ontvangstregel bestaat niet.", "onbekend");
  if (regel.status !== "open") {
    throw new BoekingsFout("Deze regel is al afgehandeld.", "al_afgehandeld");
  }

  const ontvangen = Math.floor(args.aantal ?? regel.verwacht);
  if (!Number.isInteger(ontvangen) || ontvangen <= 0) {
    throw new BoekingsFout("Ontvangen aantal moet groter dan 0 zijn.", "ongeldig_aantal");
  }

  /* Opnieuw lezen in plaats van het meegestuurde getal geloven: tussen het
     tonen van de kans en het scannen kan een collega het werk al gepikt hebben. */
  const vraag = await queryOne<{ gevraagd_open: number }>(
    `SELECT gevraagd_open FROM wms.crossdock_kansen WHERE ontvangst_regel_id = $1`,
    [regel.id]
  );
  const gevraagdOpen = Number(vraag?.gevraagd_open ?? 0);
  if (gevraagdOpen <= 0) {
    throw new BoekingsFout(
      "Er wacht geen open pickwerk meer op dit artikel — sla het gewoon in.",
      "geen_vraag"
    );
  }

  const expeditieCode =
    String(await instelling<string>("picken.expeditie_locatie")) || "EXPEDITIE";
  const expeditie = await zoekLocatie(expeditieCode);
  if (!expeditie) {
    throw new BoekingsFout(
      `Expeditielocatie "${expeditieCode}" bestaat niet — cross-docken kan nergens heen.`,
      "geen_locatie"
    );
  }

  const naarExpeditie = Math.min(ontvangen, gevraagdOpen);
  const naarMagazijn = ontvangen - naarExpeditie;

  const boeking = await boekMutatie({
    sku: regel.sku,
    naarLocatieId: expeditie.id,
    aantal: naarExpeditie,
    reden: "ontvangst",
    refType: "ontvangst-crossdock",
    refId: regel.code,
    notitie: `Cross-dock: er stond open pickwerk klaar, dus rechtstreeks naar ${expeditie.code} zonder inslag.`,
    actorId: args.actorId,
    actorNaam: args.actorNaam,
    idempotencyKey: args.idempotencyKey ? `${args.idempotencyKey}:crossdock` : null,
  });

  let magazijnCode: string | null = null;
  if (naarMagazijn > 0) {
    const code = String(await instelling<string>("inslag.startlocatie")) || "ONBEKEND";
    const magazijn = await zoekLocatie(code);
    if (!magazijn) {
      throw new BoekingsFout(
        `Wachtlocatie "${code}" bestaat niet — het overschot kan nergens heen.`,
        "geen_locatie"
      );
    }
    await boekMutatie({
      sku: regel.sku,
      naarLocatieId: magazijn.id,
      aantal: naarMagazijn,
      reden: "ontvangst",
      refType: "ontvangst",
      refId: regel.code,
      notitie: "Overschot boven de open pickvraag — niet gecross-dockt.",
      actorId: args.actorId,
      actorNaam: args.actorNaam,
      idempotencyKey: args.idempotencyKey ? `${args.idempotencyKey}:rest` : null,
    });
    magazijnCode = magazijn.code;
  }

  const status = ontvangen === regel.verwacht ? "ontvangen" : "afwijking";
  await query(
    `UPDATE wms.ontvangst_regels
        SET ontvangen = $2, locatie_id = $3, move_id = $4, status = $5,
            afgerond_at = now(),
            note = coalesce(note || ' · ', '') || 'Cross-dock naar ' || $6
      WHERE id = $1`,
    [regel.id, ontvangen, expeditie.id, boeking.id, status, expeditie.code]
  );

  /* Zelfde afronding als bij een gewone ontvangst. De helper daar is privé en
     lib/ontvangst.ts is niet van dit pakket, dus staat de regel hier nog eens. */
  await query(
    `UPDATE wms.ontvangsten o
        SET status = 'afgerond', afgerond_at = now()
      WHERE o.id = $1
        AND o.status = 'bezig'
        AND NOT EXISTS (
          SELECT 1 FROM wms.ontvangst_regels r
           WHERE r.ontvangst_id = o.id AND r.status = 'open'
        )`,
    [regel.ontvangst_id]
  );

  const melding =
    naarMagazijn > 0
      ? `${naarExpeditie} stuks naar ${expeditie.code}, ${naarMagazijn} over de vraag heen naar ${magazijnCode}.`
      : `${naarExpeditie} stuks rechtstreeks naar ${expeditie.code} — geen inslag nodig.`;

  return {
    ontvangstRegelId: regel.id,
    sku: regel.sku,
    ontvangen,
    naarExpeditie,
    naarMagazijn,
    expeditieLocatie: expeditie.code,
    magazijnLocatie: magazijnCode,
    melding,
  };
}
