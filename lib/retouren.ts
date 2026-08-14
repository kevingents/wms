import { query, queryOne, BoekingsFout } from "./db";
import { boekMutatie, zoekLocatie } from "./voorraad";
import { instelling } from "./instellingen";

/**
 * Retouren — de omgekeerde stroom.
 *
 * In mode komt een fors deel terug. Een retour is pas afgehandeld als er een
 * oordeel is: terug de verkoop in, naar herstel, of afgekeurd. Zonder dat
 * oordeel groeit er een stapel die niemand durft weg te boeken — en die stapel
 * staat wél in de voorraad, of juist níet, en in beide gevallen klopt het niet.
 *
 * Elk oordeel is een echte boeking naar een echte locatie:
 *   verkoopbaar → terug naar een piklocatie, telt weer mee als voorraad
 *   herstel     → HERSTEL, staat in het grootboek maar is niet pikbaar
 *   afkeur      → AFKEUR, wacht op afschrijving
 *
 * Dat HERSTEL en AFKEUR echte locaties zijn en geen statusvlag is bewust: de
 * spullen liggen fysiek ergens, dus horen ze ergens te staan. Een statusvlag
 * laat ze uit beeld verdwijnen terwijl ze nog in het pand liggen.
 */

export type Oordeel = "verkoopbaar" | "herstel" | "afkeur";

export const OORDEEL_LOCATIE: Record<Oordeel, string | null> = {
  verkoopbaar: null /* naar de opgegeven piklocatie */,
  herstel: "HERSTEL",
  afkeur: "AFKEUR",
};

export interface Retour {
  id: number;
  code: string;
  bron: string;
  bron_ref: string | null;
  klant: string | null;
  status: "open" | "bezig" | "afgehandeld" | "geannuleerd";
  ontvangen_at: string | null;
  afgehandeld_at: string | null;
  note: string | null;
  created_at: string;
  regels: number;
  open_regels: number;
  stuks: number;
}

export interface RetourRegel {
  id: number;
  retour_id: number;
  sku: string;
  aantal: number;
  oordeel: Oordeel | null;
  locatie_id: number | null;
  locatie_code: string | null;
  reden: string | null;
  note: string | null;
  omschrijving: string | null;
  merk: string | null;
  maat: string | null;
  kleur: string | null;
  barcode: string | null;
}

const RETOUR_SELECT = `
  SELECT t.*,
         (SELECT count(*) FROM wms.retour_regels r WHERE r.retour_id = t.id)::int AS regels,
         (SELECT count(*) FROM wms.retour_regels r
           WHERE r.retour_id = t.id AND r.oordeel IS NULL)::int                    AS open_regels,
         (SELECT coalesce(sum(r.aantal), 0) FROM wms.retour_regels r
           WHERE r.retour_id = t.id)::int                                          AS stuks
    FROM wms.retouren t`;

export async function openRetouren(): Promise<Retour[]> {
  return query<Retour>(
    `${RETOUR_SELECT} WHERE t.status IN ('open', 'bezig') ORDER BY t.created_at`
  );
}

export async function retour(id: number): Promise<Retour | null> {
  return queryOne<Retour>(`${RETOUR_SELECT} WHERE t.id = $1`, [id]);
}

export async function retourRegels(id: number): Promise<RetourRegel[]> {
  return query<RetourRegel>(
    `SELECT r.*, l.code AS locatie_code,
            a.omschrijving, a.merk, a.maat, a.kleur, a.barcode
       FROM wms.retour_regels r
       LEFT JOIN wms.locations l ON l.id = r.locatie_id
       LEFT JOIN wms.artikelen a ON a.sku = r.sku
      WHERE r.retour_id = $1
      ORDER BY (r.oordeel IS NOT NULL), r.sku`,
    [id]
  );
}

async function nieuweCode(): Promise<string> {
  const rij = await queryOne<{ n: string }>(
    `SELECT nextval('wms.retour_nummer')::text AS n`
  );
  return `RT-${String(rij?.n ?? "0").padStart(5, "0")}`;
}

/**
 * Opent een retour en boekt de goederen meteen op de retourbalie.
 *
 * Waarom meteen boeken: op het moment dat de doos openligt, zijn de spullen
 * binnen. Wachten met boeken tot iemand een oordeel heeft, betekent dat ze
 * tussen de deur en de balie onzichtbaar zijn — en dat kan dagen duren.
 */
export async function opentRetour(args: {
  bron?: string;
  bronRef?: string | null;
  klant?: string | null;
  note?: string | null;
  actorId: string;
  actorNaam: string;
  regels: { sku: string; aantal: number }[];
}): Promise<Retour> {
  const regels = args.regels
    .map((r) => ({ sku: r.sku?.trim(), aantal: Math.floor(Number(r.aantal)) }))
    .filter((r) => r.sku && Number.isInteger(r.aantal) && r.aantal > 0);

  if (regels.length === 0) {
    throw new BoekingsFout("Geef minstens één artikel met een aantal.", "geen_regels");
  }

  const balie = await zoekLocatie("RETOUR");
  if (!balie) {
    throw new BoekingsFout(
      "Locatie RETOUR bestaat niet — retouren kunnen nergens heen.",
      "geen_locatie"
    );
  }

  const code = await nieuweCode();
  const nieuw = await queryOne<{ id: number }>(
    `INSERT INTO wms.retouren
       (code, bron, bron_ref, klant, note, status, ontvangen_door, ontvangen_at)
     VALUES ($1, $2, $3, $4, $5, 'bezig', $6, now())
     RETURNING id`,
    [
      code,
      args.bron ?? "webshop",
      args.bronRef ?? null,
      args.klant ?? null,
      args.note ?? null,
      args.actorNaam,
    ]
  );

  for (const r of regels) {
    await query(
      `INSERT INTO wms.retour_regels (retour_id, sku, aantal) VALUES ($1, $2, $3)`,
      [nieuw!.id, r.sku, r.aantal]
    );
    await boekMutatie({
      sku: r.sku!,
      naarLocatieId: balie.id,
      aantal: r.aantal,
      reden: "retour",
      refType: "retour",
      refId: code,
      actorId: args.actorId,
      actorNaam: args.actorNaam,
      idempotencyKey: `retour-in:${code}:${r.sku}`,
    });
  }

  return (await retour(nieuw!.id))!;
}

/**
 * Velt het oordeel over één regel en verplaatst de goederen navenant: van de
 * retourbalie naar een piklocatie, naar herstel, of naar afkeur.
 */
export async function beoordeel(args: {
  regelId: number;
  oordeel: Oordeel;
  locatieCode?: string | null;
  reden?: string | null;
  actorId: string;
  actorNaam: string;
}): Promise<RetourRegel> {
  const regel = await queryOne<{
    id: number;
    retour_id: number;
    sku: string;
    aantal: number;
    oordeel: string | null;
    code: string;
  }>(
    `SELECT r.id, r.retour_id, r.sku, r.aantal, r.oordeel, t.code
       FROM wms.retour_regels r
       JOIN wms.retouren t ON t.id = r.retour_id
      WHERE r.id = $1`,
    [args.regelId]
  );
  if (!regel) throw new BoekingsFout("Retourregel bestaat niet.", "onbekend");
  if (regel.oordeel) {
    throw new BoekingsFout("Deze regel is al beoordeeld.", "al_beoordeeld");
  }

  const balie = await zoekLocatie("RETOUR");
  if (!balie) throw new BoekingsFout("Locatie RETOUR bestaat niet.", "geen_locatie");

  /* Waar gaat het heen? Bij 'verkoopbaar' bepaalt de medewerker het vak; bij de
     andere twee is de bestemming vast, want daar hoort niet over nagedacht te
     worden. */
  const doelCode =
    args.oordeel === "verkoopbaar"
      ? args.locatieCode?.trim() ||
        String(await instelling<string>("inslag.startlocatie")) ||
        "ONBEKEND"
      : OORDEEL_LOCATIE[args.oordeel]!;

  const doel = await zoekLocatie(doelCode);
  if (!doel) throw new BoekingsFout(`Onbekende locatie: ${doelCode}`, "geen_locatie");

  const boeking = await boekMutatie({
    sku: regel.sku,
    vanLocatieId: balie.id,
    naarLocatieId: doel.id,
    aantal: regel.aantal,
    reden: args.oordeel === "verkoopbaar" ? "inslag" : "verplaatsing",
    refType: "retour-oordeel",
    refId: regel.code,
    notitie: `Retour beoordeeld als ${args.oordeel}${args.reden ? ` — ${args.reden}` : ""}`,
    actorId: args.actorId,
    actorNaam: args.actorNaam,
    idempotencyKey: `retour-oordeel:${regel.code}:${regel.id}`,
  });

  await query(
    `UPDATE wms.retour_regels
        SET oordeel = $2, locatie_id = $3, reden = $4, move_id = $5, afgerond_at = now()
      WHERE id = $1`,
    [regel.id, args.oordeel, doel.id, args.reden ?? null, boeking.id]
  );

  await query(
    `UPDATE wms.retouren t
        SET status = 'afgehandeld', afgehandeld_at = now()
      WHERE t.id = $1
        AND t.status = 'bezig'
        AND NOT EXISTS (
          SELECT 1 FROM wms.retour_regels r
           WHERE r.retour_id = t.id AND r.oordeel IS NULL
        )`,
    [regel.retour_id]
  );

  const regels = await retourRegels(regel.retour_id);
  return regels.find((r) => r.id === regel.id)!;
}

/**
 * Schrijft afgekeurde voorraad af: van AFKEUR het pand uit. Aparte handeling en
 * bewust niet automatisch — iemand moet ervoor tekenen dat er geld weggaat.
 */
export async function schrijfAf(args: {
  sku: string;
  aantal: number;
  reden: string;
  actorId: string;
  actorNaam: string;
}): Promise<void> {
  const afkeur = await zoekLocatie("AFKEUR");
  if (!afkeur) throw new BoekingsFout("Locatie AFKEUR bestaat niet.", "geen_locatie");

  await boekMutatie({
    sku: args.sku,
    vanLocatieId: afkeur.id,
    naarLocatieId: null,
    aantal: args.aantal,
    reden: "afschrijving",
    refType: "afschrijving",
    notitie: args.reden,
    actorId: args.actorId,
    actorNaam: args.actorNaam,
  });
}
