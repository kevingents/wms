import { query, queryOne } from "./db";
import { instelling } from "./instellingen";

/**
 * Bewaking — signalen die iemand moet zien.
 *
 * Niet elk probleem is een foutmelding. Werk dat blijft liggen, een
 * sluitcontrole die wegloopt, voorraad zonder kostprijs: dat crasht niets, maar
 * het gaat wel scheef als niemand het opmerkt. Een foutmelding schreeuwt en
 * verdwijnt; een signaal blijft staan tot iemand er iets mee doet.
 *
 * DE TWEE REGELS DIE DIT BRUIKBAAR HOUDEN
 * ---------------------------------------
 * 1. Eén open signaal per (soort, referentie). De unieke index in de database
 *    dwingt dat af. Zonder die regel staat er morgen dertig keer hetzelfde en
 *    kijkt niemand er meer naar — en dan is de bewaking erger dan geen bewaking.
 * 2. Wat opgelost is, sluit zichzelf. Een signaal dat blijft staan nadat het
 *    probleem weg is, leert mensen om signalen te negeren.
 */

export type Ernst = "info" | "let_op" | "urgent";

export interface Signaal {
  id: number;
  soort: string;
  ernst: Ernst;
  titel: string;
  toelichting: string | null;
  ref_type: string | null;
  ref_id: string | null;
  waarde: number | null;
  status: "open" | "afgehandeld" | "genegeerd";
  afgehandeld_door: string | null;
  afgehandeld_at: string | null;
  created_at: string;
}

export async function openSignalen(limiet = 100): Promise<Signaal[]> {
  return query<Signaal>(
    `SELECT * FROM wms.signalen
      WHERE status = 'open'
      ORDER BY CASE ernst WHEN 'urgent' THEN 0 WHEN 'let_op' THEN 1 ELSE 2 END,
               created_at DESC
      LIMIT $1`,
    [limiet]
  );
}

/** Idempotent: bestaat er al een open signaal voor dit (soort, ref), dan niets. */
export async function maakSignaal(args: {
  soort: string;
  ernst?: Ernst;
  titel: string;
  toelichting?: string | null;
  refType?: string | null;
  refId?: string | null;
  waarde?: number | null;
}): Promise<boolean> {
  const rij = await queryOne<{ id: number }>(
    `INSERT INTO wms.signalen (soort, ernst, titel, toelichting, ref_type, ref_id, waarde)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      args.soort,
      args.ernst ?? "let_op",
      args.titel,
      args.toelichting ?? null,
      args.refType ?? null,
      args.refId ?? null,
      args.waarde ?? null,
    ]
  );
  return Boolean(rij);
}

export async function handelAf(id: number, door: string): Promise<void> {
  await query(
    `UPDATE wms.signalen
        SET status = 'afgehandeld', afgehandeld_door = $2, afgehandeld_at = now()
      WHERE id = $1 AND status = 'open'`,
    [id, door]
  );
}

export async function negeer(id: number, door: string): Promise<void> {
  await query(
    `UPDATE wms.signalen
        SET status = 'genegeerd', afgehandeld_door = $2, afgehandeld_at = now()
      WHERE id = $1 AND status = 'open'`,
    [id, door]
  );
}

/** Sluit signalen van een soort waarvan de referenties niet meer voorkomen. */
async function sluitOpgeloste(soort: string, nogGeldig: string[]): Promise<number> {
  const rijen = await query<{ id: number }>(
    `UPDATE wms.signalen
        SET status = 'afgehandeld', afgehandeld_door = 'systeem', afgehandeld_at = now()
      WHERE soort = $1 AND status = 'open'
        AND NOT (coalesce(ref_id, '') = ANY($2::text[]))
      RETURNING id`,
    [soort, nogGeldig]
  );
  return rijen.length;
}

/* ── De bewakingsregels ────────────────────────────────────────────────────── */

export interface ControleResultaat {
  nieuw: number;
  gesloten: number;
  regels: { regel: string; nieuw: number; gesloten: number }[];
}

/**
 * Draait alle regels. Bedoeld voor de ochtendcron, maar handmatig aanroepen mag —
 * hij is idempotent.
 */
export async function controleerAlles(): Promise<ControleResultaat> {
  const regels: { regel: string; nieuw: number; gesloten: number }[] = [];
  let nieuw = 0;
  let gesloten = 0;

  function boek(regel: string, n: number, g: number) {
    regels.push({ regel, nieuw: n, gesloten: g });
    nieuw += n;
    gesloten += g;
  }

  /* ── Pickwerk dat blijft liggen ─────────────────────────────────────────── */
  const pickDrempel = Number(await instelling<number>("bewaking.pick_uren_alarm")) || 24;
  const oudePicks = await query<{ code: string; uren: number; bestemming: string | null }>(
    `SELECT code,
            round(extract(epoch FROM (now() - created_at)) / 3600)::int AS uren,
            bestemming
       FROM wms.pick_orders
      WHERE status IN ('open', 'bezig')
        AND created_at < now() - ($1 || ' hours')::interval
      ORDER BY created_at`,
    [String(pickDrempel)]
  );
  let n = 0;
  for (const p of oudePicks) {
    if (
      await maakSignaal({
        soort: "pick_blijft_liggen",
        ernst: p.uren > pickDrempel * 3 ? "urgent" : "let_op",
        titel: `Pickopdracht ${p.code} staat ${p.uren} uur open`,
        toelichting: `Bestemming ${p.bestemming ?? "onbekend"}. Werk dat niemand meer ziet is hoe achterstanden ontstaan.`,
        refType: "pickopdracht",
        refId: p.code,
        waarde: p.uren,
      })
    )
      n += 1;
  }
  boek(
    "pickwerk blijft liggen",
    n,
    await sluitOpgeloste("pick_blijft_liggen", oudePicks.map((p) => p.code))
  );

  /* ── Sluitcontrole voorraadwaarde ───────────────────────────────────────── */
  const waarde = await queryOne<{ verschil: string }>(
    `SELECT coalesce(verschil, 0)::text AS verschil FROM wms.waarde_sluitcontrole`
  ).catch(() => null);
  const waardeVerschil = Math.abs(Number(waarde?.verschil ?? 0));
  n = 0;
  if (waardeVerschil > 0.5) {
    if (
      await maakSignaal({
        soort: "waarde_sluit_niet",
        ernst: "urgent",
        titel: "Voorraadwaarde sluit niet",
        toelichting: `In minus uit wijkt ${waardeVerschil.toFixed(2)} euro af van de waarde op voorraad. Dit hoort exact nul te zijn.`,
        refType: "sluitcontrole",
        refId: "waarde",
        waarde: waardeVerschil,
      })
    )
      n = 1;
  }
  boek(
    "sluitcontrole waarde",
    n,
    await sluitOpgeloste("waarde_sluit_niet", waardeVerschil > 0.5 ? ["waarde"] : [])
  );

  /* ── Grootboek in balans per periode ────────────────────────────────────── */
  const scheef = await query<{ periode: string; verschil: string }>(
    `SELECT periode::text, verschil::text FROM wms.grootboek_balans
      WHERE abs(verschil) > 0.005`
  ).catch(() => []);
  n = 0;
  for (const s of scheef) {
    if (
      await maakSignaal({
        soort: "grootboek_scheef",
        ernst: "urgent",
        titel: `Grootboek niet in balans in ${s.periode}`,
        toelichting: `Debet en credit lopen ${Number(s.verschil).toFixed(2)} euro uiteen. Een scheve journaalpost mag niet naar de boekhouding.`,
        refType: "periode",
        refId: s.periode,
        waarde: Number(s.verschil),
      })
    )
      n += 1;
  }
  boek(
    "grootboekbalans",
    n,
    await sluitOpgeloste("grootboek_scheef", scheef.map((s) => s.periode))
  );

  /* ── Voorraad zonder kostprijs ──────────────────────────────────────────── */
  const zonderPrijs = await queryOne<{ n: string; stuks: string }>(
    `SELECT count(*)::text AS n, coalesce(sum(qty), 0)::text AS stuks
       FROM wms.waarde_ontbreekt`
  ).catch(() => null);
  const aantalZonder = Number(zonderPrijs?.n ?? 0);
  n = 0;
  if (aantalZonder > 50) {
    if (
      await maakSignaal({
        soort: "kostprijs_ontbreekt",
        ernst: "let_op",
        titel: `${aantalZonder} artikelen zonder kostprijs`,
        toelichting: `${zonderPrijs?.stuks} stuks staan zonder waarde in de voorraad. Die tellen niet mee in de waardering.`,
        refType: "waardering",
        refId: "kostprijs",
        waarde: aantalZonder,
      })
    )
      n = 1;
  }
  boek(
    "kostprijs ontbreekt",
    n,
    await sluitOpgeloste("kostprijs_ontbreekt", aantalZonder > 50 ? ["kostprijs"] : [])
  );

  /* ── Piklocatie leeg zonder aanvultaak ──────────────────────────────────── */
  const leegZonderTaak = await query<{ pick_locatie: string; sku: string }>(
    `SELECT r.pick_locatie, r.sku
       FROM wms.replen_advies r
      WHERE r.aanwezig = 0
        AND NOT EXISTS (
          SELECT 1 FROM wms.taken t
           WHERE t.soort = 'replenishment'
             AND t.naar_locatie_id = r.pick_locatie_id
             AND t.status IN ('open', 'bezig')
        )`
  ).catch(() => []);
  n = 0;
  for (const l of leegZonderTaak) {
    if (
      await maakSignaal({
        soort: "pikvak_leeg",
        ernst: "let_op",
        titel: `Piklocatie ${l.pick_locatie} is leeg`,
        toelichting: `Geen voorraad en geen openstaande aanvultaak. De volgende picker staat voor een leeg vak.`,
        refType: "locatie",
        refId: l.pick_locatie,
      })
    )
      n += 1;
  }
  boek(
    "leeg pikvak",
    n,
    await sluitOpgeloste("pikvak_leeg", leegZonderTaak.map((l) => l.pick_locatie))
  );

  /* ── Ontvangst die blijft hangen ────────────────────────────────────────── */
  const hangendeOntvangst = await query<{ code: string; dagen: number }>(
    `SELECT code, extract(day FROM now() - gestart_at)::int AS dagen
       FROM wms.ontvangsten
      WHERE status = 'bezig' AND gestart_at < now() - interval '2 days'`
  );
  n = 0;
  for (const o of hangendeOntvangst) {
    if (
      await maakSignaal({
        soort: "ontvangst_hangt",
        ernst: "let_op",
        titel: `Ontvangst ${o.code} staat ${o.dagen} dagen halverwege`,
        toelichting:
          "Een levering die half uitgepakt blijft, betekent voorraad die er wel is maar niet in het systeem staat.",
        refType: "ontvangst",
        refId: o.code,
        waarde: o.dagen,
      })
    )
      n += 1;
  }
  boek(
    "ontvangst hangt",
    n,
    await sluitOpgeloste("ontvangst_hangt", hangendeOntvangst.map((o) => o.code))
  );

  /* ── Ingepakt maar niet verzonden ───────────────────────────────────────── */
  const blijftStaan = await query<{ code: string; dagen: number }>(
    `SELECT code, extract(day FROM now() - ingepakt_at)::int AS dagen
       FROM wms.zendingen
      WHERE status = 'ingepakt' AND ingepakt_at < now() - interval '1 day'`
  );
  n = 0;
  for (const z of blijftStaan) {
    if (
      await maakSignaal({
        soort: "zending_blijft_staan",
        ernst: z.dagen > 3 ? "urgent" : "let_op",
        titel: `Zending ${z.code} staat ${z.dagen} dag(en) ingepakt op de kade`,
        toelichting:
          "De doos is dicht maar niet verzonden. De klant wacht, en de voorraad staat nog op expeditie.",
        refType: "zending",
        refId: z.code,
        waarde: z.dagen,
      })
    )
      n += 1;
  }
  boek(
    "zending blijft staan",
    n,
    await sluitOpgeloste("zending_blijft_staan", blijftStaan.map((z) => z.code))
  );

  /* ── Retour zonder oordeel ──────────────────────────────────────────────── */
  const oudeRetouren = await query<{ code: string; dagen: number }>(
    `SELECT code, extract(day FROM now() - ontvangen_at)::int AS dagen
       FROM wms.retouren
      WHERE status IN ('open', 'bezig') AND ontvangen_at < now() - interval '3 days'`
  );
  n = 0;
  for (const r of oudeRetouren) {
    if (
      await maakSignaal({
        soort: "retour_onbeoordeeld",
        ernst: "let_op",
        titel: `Retour ${r.code} ligt ${r.dagen} dagen zonder oordeel`,
        toelichting:
          "Zolang er geen oordeel is, ligt de voorraad op de retourbalie en is hij niet verkoopbaar.",
        refType: "retour",
        refId: r.code,
        waarde: r.dagen,
      })
    )
      n += 1;
  }
  boek(
    "retour onbeoordeeld",
    n,
    await sluitOpgeloste("retour_onbeoordeeld", oudeRetouren.map((r) => r.code))
  );

  return { nieuw, gesloten, regels };
}
