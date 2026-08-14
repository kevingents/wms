import { query, queryOne, BoekingsFout } from "./db";
import { boekMutatie, zoekLocatie } from "./voorraad";
import { instelling } from "./instellingen";

/**
 * Ontvangst — goederen het magazijn in, tegen een verwachting.
 *
 * WAAROM TEGEN EEN VERWACHTING
 * ----------------------------
 * Ontvangen zonder verwachting is hetzelfde als tellen: je boekt wat je ziet en
 * niemand merkt dat de leverancier veertig stuks stuurde waar er vijftig
 * besteld waren. Dat verschil is geld, en het is alleen op het moment van
 * uitpakken vast te stellen — een week later is de doos weg en het bewijs ook.
 *
 * WAT ER MET AFWIJKINGEN GEBEURT
 * ------------------------------
 * Niets automatisch. Een tekort of een teveel wordt vastgelegd en zichtbaar
 * gemaakt; wat er vervolgens met de leverancier gebeurt is inkoopwerk en hoort
 * bij de portal. Het WMS levert de waarneming, niet het oordeel.
 *
 * Beschadigde goederen gaan naar QUARANTAINE en niet naar het schap. Ze staan
 * dus wél in het grootboek — anders verdwijnen ze uit beeld terwijl ze fysiek
 * in het pand liggen, en dat is precies hoe spookvoorraad ontstaat.
 */

export interface Ontvangst {
  id: number;
  code: string;
  bron: string;
  bron_ref: string | null;
  leverancier: string | null;
  referentie: string | null;
  status: "verwacht" | "bezig" | "afgerond" | "geannuleerd";
  verwacht_op: string | null;
  gestart_at: string | null;
  afgerond_at: string | null;
  note: string | null;
  created_at: string;
  regels: number;
  open_regels: number;
  verwacht_stuks: number;
  ontvangen_stuks: number;
  afwijkingen: number;
}

export interface OntvangstRegel {
  id: number;
  ontvangst_id: number;
  sku: string;
  verwacht: number;
  ontvangen: number;
  afgekeurd: number;
  locatie_id: number | null;
  locatie_code: string | null;
  reden_afkeur: string | null;
  status: "open" | "ontvangen" | "afwijking" | "overgeslagen";
  note: string | null;
  omschrijving: string | null;
  merk: string | null;
  maat: string | null;
  kleur: string | null;
  barcode: string | null;
}

const ONTVANGST_SELECT = `
  SELECT o.*,
         (SELECT count(*) FROM wms.ontvangst_regels r WHERE r.ontvangst_id = o.id)::int AS regels,
         (SELECT count(*) FROM wms.ontvangst_regels r
           WHERE r.ontvangst_id = o.id AND r.status = 'open')::int                       AS open_regels,
         (SELECT coalesce(sum(r.verwacht), 0) FROM wms.ontvangst_regels r
           WHERE r.ontvangst_id = o.id)::int                                             AS verwacht_stuks,
         (SELECT coalesce(sum(r.ontvangen), 0) FROM wms.ontvangst_regels r
           WHERE r.ontvangst_id = o.id)::int                                             AS ontvangen_stuks,
         (SELECT count(*) FROM wms.ontvangst_regels r
           WHERE r.ontvangst_id = o.id AND r.status = 'afwijking')::int                  AS afwijkingen
    FROM wms.ontvangsten o`;

export async function openOntvangsten(): Promise<Ontvangst[]> {
  return query<Ontvangst>(
    `${ONTVANGST_SELECT}
      WHERE o.status IN ('verwacht', 'bezig')
      ORDER BY o.verwacht_op NULLS LAST, o.created_at`
  );
}

export async function ontvangst(id: number): Promise<Ontvangst | null> {
  return queryOne<Ontvangst>(`${ONTVANGST_SELECT} WHERE o.id = $1`, [id]);
}

export async function ontvangstRegels(id: number): Promise<OntvangstRegel[]> {
  return query<OntvangstRegel>(
    `SELECT r.*, l.code AS locatie_code,
            a.omschrijving, a.merk, a.maat, a.kleur, a.barcode
       FROM wms.ontvangst_regels r
       LEFT JOIN wms.locations l ON l.id = r.locatie_id
       LEFT JOIN wms.artikelen a ON a.sku = r.sku
      WHERE r.ontvangst_id = $1
      ORDER BY (r.status <> 'open'), r.sku`,
    [id]
  );
}

async function nieuweCode(): Promise<string> {
  const rij = await queryOne<{ n: string }>(
    `SELECT nextval('wms.ontvangst_nummer')::text AS n`
  );
  return `O-${String(rij?.n ?? "0").padStart(5, "0")}`;
}

/** Idempotent op (bron, bron_ref) — een inkooporder twee keer aanmelden mag. */
export async function maakOntvangst(args: {
  bron?: string;
  bronRef?: string | null;
  leverancier?: string | null;
  referentie?: string | null;
  verwachtOp?: string | null;
  note?: string | null;
  door: string | null;
  regels: { sku: string; verwacht: number }[];
}): Promise<Ontvangst | false> {
  const code = await nieuweCode();
  const bron = args.bron ?? "handmatig";
  const bronRef = args.bronRef ?? code;

  const nieuw = await queryOne<{ id: number }>(
    `INSERT INTO wms.ontvangsten
       (code, bron, bron_ref, leverancier, referentie, verwacht_op, note, aangemaakt_door)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (bron, bron_ref) DO NOTHING
     RETURNING id`,
    [
      code,
      bron,
      bronRef,
      args.leverancier ?? null,
      args.referentie ?? null,
      args.verwachtOp ?? null,
      args.note ?? null,
      args.door,
    ]
  );
  if (!nieuw) return false;

  /* Dezelfde sku twee keer op één levering wordt één regel — anders staat de
     uitpakker twee keer hetzelfde af te vinken. */
  const perSku = new Map<string, number>();
  for (const r of args.regels) {
    if (!r.sku?.trim() || !Number.isInteger(r.verwacht) || r.verwacht < 0) continue;
    perSku.set(r.sku.trim(), (perSku.get(r.sku.trim()) ?? 0) + r.verwacht);
  }

  for (const [sku, verwacht] of perSku) {
    await query(
      `INSERT INTO wms.ontvangst_regels (ontvangst_id, sku, verwacht)
       VALUES ($1, $2, $3)
       ON CONFLICT (ontvangst_id, sku) DO UPDATE SET verwacht = excluded.verwacht`,
      [nieuw.id, sku, verwacht]
    );
  }

  return (await ontvangst(nieuw.id))!;
}

export async function startOntvangst(
  id: number,
  door: string
): Promise<Ontvangst | null> {
  await query(
    `UPDATE wms.ontvangsten
        SET status = 'bezig', gestart_at = coalesce(gestart_at, now()), gestart_door = $2
      WHERE id = $1 AND status IN ('verwacht', 'bezig')`,
    [id, door]
  );
  return ontvangst(id);
}

/**
 * Boekt één ontvangstregel in.
 *
 * Goed materiaal gaat naar de opgegeven locatie (of de standaard inslaglocatie),
 * afgekeurd materiaal naar quarantaine. Dat zijn twee aparte boekingen met een
 * eigen reden, zodat later te zien is wat er binnenkwam én wat er mis mee was —
 * één netto getal zou dat verhaal weggooien.
 */
export async function boekOntvangstRegel(args: {
  regelId: number;
  ontvangen: number;
  afgekeurd?: number;
  locatieCode?: string | null;
  redenAfkeur?: string | null;
  actorId: string;
  actorNaam: string;
  idempotencyKey?: string | null;
}): Promise<OntvangstRegel> {
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
    [args.regelId]
  );
  if (!regel) throw new BoekingsFout("Ontvangstregel bestaat niet.", "onbekend");
  if (regel.status !== "open") {
    throw new BoekingsFout("Deze regel is al afgehandeld.", "al_afgehandeld");
  }

  const ontvangen = Math.floor(args.ontvangen);
  const afgekeurd = Math.floor(args.afgekeurd ?? 0);
  if (!Number.isInteger(ontvangen) || ontvangen < 0) {
    throw new BoekingsFout("Ontvangen aantal moet 0 of hoger zijn.", "ongeldig_aantal");
  }
  if (afgekeurd < 0 || afgekeurd > ontvangen) {
    throw new BoekingsFout(
      "Afgekeurd aantal kan niet hoger zijn dan wat je ontvangen hebt.",
      "ongeldig_aantal"
    );
  }

  const goedeAantal = ontvangen - afgekeurd;
  let moveId: number | null = null;
  let afkeurMoveId: number | null = null;

  if (goedeAantal > 0) {
    const code =
      args.locatieCode?.trim() ||
      String(await instelling<string>("inslag.startlocatie")) ||
      "ONBEKEND";
    const locatie = await zoekLocatie(code);
    if (!locatie) throw new BoekingsFout(`Onbekende locatie: ${code}`, "geen_locatie");

    const boeking = await boekMutatie({
      sku: regel.sku,
      naarLocatieId: locatie.id,
      aantal: goedeAantal,
      reden: "ontvangst",
      refType: "ontvangst",
      refId: regel.code,
      actorId: args.actorId,
      actorNaam: args.actorNaam,
      idempotencyKey: args.idempotencyKey ? `${args.idempotencyKey}:goed` : null,
    });
    moveId = boeking.id;

    await query(`UPDATE wms.ontvangst_regels SET locatie_id = $2 WHERE id = $1`, [
      regel.id,
      locatie.id,
    ]);
  }

  if (afgekeurd > 0) {
    const quarantaine = await zoekLocatie("QUARANTAINE");
    if (!quarantaine) {
      throw new BoekingsFout(
        "Locatie QUARANTAINE bestaat niet — afgekeurde goederen kunnen nergens heen.",
        "geen_quarantaine"
      );
    }
    const boeking = await boekMutatie({
      sku: regel.sku,
      naarLocatieId: quarantaine.id,
      aantal: afgekeurd,
      reden: "ontvangst",
      refType: "ontvangst-afkeur",
      refId: regel.code,
      notitie: args.redenAfkeur ?? "Afgekeurd bij ontvangst",
      actorId: args.actorId,
      actorNaam: args.actorNaam,
      idempotencyKey: args.idempotencyKey ? `${args.idempotencyKey}:afkeur` : null,
    });
    afkeurMoveId = boeking.id;
  }

  const status = ontvangen === regel.verwacht && afgekeurd === 0 ? "ontvangen" : "afwijking";

  await query(
    `UPDATE wms.ontvangst_regels
        SET ontvangen = $2, afgekeurd = $3, reden_afkeur = $4,
            move_id = $5, afkeur_move_id = $6, status = $7, afgerond_at = now()
      WHERE id = $1`,
    [regel.id, ontvangen, afgekeurd, args.redenAfkeur ?? null, moveId, afkeurMoveId, status]
  );

  await rondOntvangstAfAlsKlaar(regel.ontvangst_id);

  const bijgewerkt = await queryOne<OntvangstRegel>(
    `SELECT r.*, l.code AS locatie_code,
            a.omschrijving, a.merk, a.maat, a.kleur, a.barcode
       FROM wms.ontvangst_regels r
       LEFT JOIN wms.locations l ON l.id = r.locatie_id
       LEFT JOIN wms.artikelen a ON a.sku = r.sku
      WHERE r.id = $1`,
    [regel.id]
  );
  return bijgewerkt!;
}

/**
 * Voegt een regel toe die niet op de pakbon stond. Dat gebeurt: een leverancier
 * stuurt iets mee dat niet besteld was. Zo'n regel krijgt `verwacht = 0` en komt
 * daarmee vanzelf als afwijking te staan — precies wat inkoop moet zien.
 */
export async function voegOnverwachteRegelToe(
  ontvangstId: number,
  sku: string
): Promise<OntvangstRegel> {
  const rij = await queryOne<{ id: number }>(
    `INSERT INTO wms.ontvangst_regels (ontvangst_id, sku, verwacht, note)
     VALUES ($1, $2, 0, 'Stond niet op de verwachting')
     ON CONFLICT (ontvangst_id, sku) DO UPDATE SET sku = excluded.sku
     RETURNING id`,
    [ontvangstId, sku.trim()]
  );
  const regels = await ontvangstRegels(ontvangstId);
  return regels.find((r) => r.id === rij!.id)!;
}

export async function slaOntvangstRegelOver(
  regelId: number,
  reden: string
): Promise<void> {
  const rij = await queryOne<{ ontvangst_id: number }>(
    `UPDATE wms.ontvangst_regels
        SET status = 'overgeslagen', note = $2, afgerond_at = now()
      WHERE id = $1 AND status = 'open'
      RETURNING ontvangst_id`,
    [regelId, reden]
  );
  if (rij) await rondOntvangstAfAlsKlaar(rij.ontvangst_id);
}

async function rondOntvangstAfAlsKlaar(ontvangstId: number): Promise<void> {
  await query(
    `UPDATE wms.ontvangsten o
        SET status = 'afgerond', afgerond_at = now()
      WHERE o.id = $1
        AND o.status = 'bezig'
        AND NOT EXISTS (
          SELECT 1 FROM wms.ontvangst_regels r
           WHERE r.ontvangst_id = o.id AND r.status = 'open'
        )`,
    [ontvangstId]
  );
}
