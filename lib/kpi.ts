import { query, queryOne } from "./db";

/**
 * Meten. Alles hier komt uit het grootboek en de werkprocessen zelf — er is geen
 * aparte registratie die bijgehouden moet worden. Wat geboekt is, is gedaan.
 *
 * Dat is niet alleen makkelijker, het is ook eerlijker: een aparte urenlijst kun
 * je invullen zoals je wilt, een boeking niet.
 */

export interface DagCijfers {
  dag: string;
  boekingen: number;
  stuks: number;
  ontvangen: number;
  gepikt: number;
  verzonden: number;
  geteld: number;
}

/** Doorvoer per dag, uitgesplitst naar wat voor werk het was. */
export async function doorvoer(dagen = 14): Promise<DagCijfers[]> {
  return query<DagCijfers>(
    `SELECT (created_at AT TIME ZONE 'Europe/Amsterdam')::date::text AS dag,
            count(*)::int                                            AS boekingen,
            coalesce(sum(qty), 0)::int                                AS stuks,
            coalesce(sum(qty) FILTER (WHERE reason = 'ontvangst'), 0)::int  AS ontvangen,
            coalesce(sum(qty) FILTER (WHERE reason = 'pick'), 0)::int       AS gepikt,
            coalesce(sum(qty) FILTER (WHERE reason = 'verzonden'), 0)::int  AS verzonden,
            count(*) FILTER (WHERE reason = 'telling')::int                 AS geteld
       FROM wms.stock_moves
      WHERE created_at > now() - ($1 || ' days')::interval
      GROUP BY 1
      ORDER BY 1 DESC`,
    [String(dagen)]
  );
}

export interface MedewerkerCijfers {
  medewerker: string;
  boekingen: number;
  stuks: number;
  actieve_minuten: number;
  per_uur: number;
}

/**
 * Productiviteit per medewerker over een periode.
 *
 * `actieve_minuten` is de tijd tussen de eerste en laatste boeking van een dag —
 * inclusief pauzes en ander werk. Het is dus een ondergrens van het tempo, geen
 * prestatiemeting per persoon. Zo hoort het ook gebruikt te worden: om te zien
 * waar het proces stroef loopt, niet om mensen af te rekenen.
 */
export async function productiviteit(dagen = 7): Promise<MedewerkerCijfers[]> {
  return query<MedewerkerCijfers>(
    `WITH per_dag AS (
       SELECT coalesce(nullif(trim(actor_name), ''), 'onbekend') AS medewerker,
              (created_at AT TIME ZONE 'Europe/Amsterdam')::date  AS dag,
              count(*)::int                                       AS boekingen,
              sum(qty)::int                                       AS stuks,
              greatest(
                extract(epoch FROM (max(created_at) - min(created_at))) / 60, 1
              )                                                   AS minuten
         FROM wms.stock_moves
        WHERE created_at > now() - ($1 || ' days')::interval
        GROUP BY 1, 2
     )
     SELECT medewerker,
            sum(boekingen)::int                              AS boekingen,
            sum(stuks)::int                                  AS stuks,
            round(sum(minuten))::int                          AS actieve_minuten,
            round(sum(boekingen) / (sum(minuten) / 60.0), 1)  AS per_uur
       FROM per_dag
      GROUP BY medewerker
      ORDER BY boekingen DESC`,
    [String(dagen)]
  );
}

export interface Doorlooptijd {
  bron: string;
  opdrachten: number;
  gem_wacht_minuten: number | null;
  gem_werk_minuten: number | null;
  gem_totaal_minuten: number | null;
}

/**
 * Hoe lang duurt het van "er is werk" tot "de deur uit", per bron.
 *
 * De splitsing tussen wachten en werken is het nuttigste getal dat hier staat:
 * lange wachttijd betekent te weinig mensen of te laat vrijgeven, lange werktijd
 * betekent dat de looproute of de indeling niet klopt. Dat zijn twee heel
 * verschillende oplossingen.
 */
export async function doorlooptijden(dagen = 30): Promise<Doorlooptijd[]> {
  return query<Doorlooptijd>(
    `SELECT bron,
            count(*)::int                        AS opdrachten,
            round(avg(wacht_minuten)::numeric, 1)  AS gem_wacht_minuten,
            round(avg(werk_minuten)::numeric, 1)   AS gem_werk_minuten,
            round(avg(totaal_minuten)::numeric, 1) AS gem_totaal_minuten
       FROM wms.pick_doorlooptijd
      WHERE finished_at > now() - ($1 || ' days')::interval
      GROUP BY bron
      ORDER BY opdrachten DESC`,
    [String(dagen)]
  );
}

export interface Nauwkeurigheid {
  geteld: number;
  klopte: number;
  afwijkend: number;
  stuks_afwijking: number;
  percentage_goed: number | null;
}

/**
 * Telnauwkeurigheid over een periode. Dít is het cijfer dat zegt of het systeem
 * de werkelijkheid volgt — belangrijker dan doorvoer, want een snel magazijn met
 * verkeerde voorraad levert alleen maar sneller de verkeerde dingen.
 */
export async function nauwkeurigheid(dagen = 30): Promise<Nauwkeurigheid> {
  const rij = await queryOne<Record<string, string>>(
    `SELECT count(*)::text                                        AS geteld,
            count(*) FILTER (WHERE verschil = 0)::text            AS klopte,
            count(*) FILTER (WHERE verschil <> 0)::text           AS afwijkend,
            coalesce(sum(abs(verschil)), 0)::text                 AS stuks_afwijking,
            round(
              100.0 * count(*) FILTER (WHERE verschil = 0) / nullif(count(*), 0), 1
            )::text                                                AS percentage_goed
       FROM wms.count_lines
      WHERE created_at > now() - ($1 || ' days')::interval`,
    [String(dagen)]
  );
  return {
    geteld: Number(rij?.geteld ?? 0),
    klopte: Number(rij?.klopte ?? 0),
    afwijkend: Number(rij?.afwijkend ?? 0),
    stuks_afwijking: Number(rij?.stuks_afwijking ?? 0),
    percentage_goed: rij?.percentage_goed ? Number(rij.percentage_goed) : null,
  };
}

export interface WerkStand {
  pick_open: number;
  pick_bezig: number;
  rondes_open: number;
  taken_open: number;
  ontvangst_open: number;
  retour_open: number;
  zending_open: number;
  oudste_pick_uren: number | null;
}

/**
 * De actuele werkstand — wat er nu open staat. `oudste_pick_uren` is de
 * belangrijkste: als daar een getal van twee dagen staat, is er iets blijven
 * liggen dat niemand meer ziet.
 */
export async function werkstand(): Promise<WerkStand> {
  const rij = await queryOne<Record<string, string>>(
    `SELECT
       (SELECT count(*) FROM wms.pick_orders WHERE status = 'open')::text        AS pick_open,
       (SELECT count(*) FROM wms.pick_orders WHERE status = 'bezig')::text       AS pick_bezig,
       (SELECT count(*) FROM wms.pick_rondes
         WHERE status IN ('open', 'bezig'))::text                                AS rondes_open,
       (SELECT count(*) FROM wms.taken
         WHERE status IN ('open', 'bezig'))::text                                AS taken_open,
       (SELECT count(*) FROM wms.ontvangsten
         WHERE status IN ('verwacht', 'bezig'))::text                            AS ontvangst_open,
       (SELECT count(*) FROM wms.retouren
         WHERE status IN ('open', 'bezig'))::text                                AS retour_open,
       (SELECT count(*) FROM wms.zendingen
         WHERE status IN ('open', 'ingepakt'))::text                             AS zending_open,
       (SELECT round(extract(epoch FROM (now() - min(created_at))) / 3600, 1)
          FROM wms.pick_orders WHERE status IN ('open', 'bezig'))::text          AS oudste_pick_uren`
  );
  return {
    pick_open: Number(rij?.pick_open ?? 0),
    pick_bezig: Number(rij?.pick_bezig ?? 0),
    rondes_open: Number(rij?.rondes_open ?? 0),
    taken_open: Number(rij?.taken_open ?? 0),
    ontvangst_open: Number(rij?.ontvangst_open ?? 0),
    retour_open: Number(rij?.retour_open ?? 0),
    zending_open: Number(rij?.zending_open ?? 0),
    oudste_pick_uren: rij?.oudste_pick_uren ? Number(rij.oudste_pick_uren) : null,
  };
}

/* ── Audit ─────────────────────────────────────────────────────────────────── */

export interface AuditRegel {
  id: number;
  actor_naam: string | null;
  actie: string;
  object_type: string;
  object_id: string | null;
  oud: unknown;
  nieuw: unknown;
  note: string | null;
  created_at: string;
}

/**
 * Legt een wijziging vast die géén voorraadmutatie is. Het grootboek verantwoordt
 * elke beweging van een artikel; dit verantwoordt de rest — wie zette een
 * instelling om, wie deactiveerde een locatie. Zonder dit is "het stond gisteren
 * anders" niet te beantwoorden.
 */
export async function legVast(args: {
  actorId?: string | null;
  actorNaam?: string | null;
  actie: string;
  objectType: string;
  objectId?: string | null;
  oud?: unknown;
  nieuw?: unknown;
  note?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO wms.audit_log
       (actor_id, actor_naam, actie, object_type, object_id, oud, nieuw, note)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
    [
      args.actorId ?? null,
      args.actorNaam ?? null,
      args.actie,
      args.objectType,
      args.objectId ?? null,
      args.oud == null ? null : JSON.stringify(args.oud),
      args.nieuw == null ? null : JSON.stringify(args.nieuw),
      args.note ?? null,
    ]
  );
}

export async function auditLog(limiet = 100): Promise<AuditRegel[]> {
  return query<AuditRegel>(
    `SELECT * FROM wms.audit_log ORDER BY created_at DESC, id DESC LIMIT $1`,
    [limiet]
  );
}
