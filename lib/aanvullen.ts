import { query, queryOne } from "./db";

/**
 * Leverbaarheidsanalyse — wat kan het magazijn van de keten-tekorten dekken?
 *
 * DIT IS GEEN AANVULADVIES. Wie welke stuks krijgt is een afweging van
 * verkoopsnelheid, marge, seizoen en handelsvoorraad — dat weet de portal
 * (`replenishment-advice.js`, `herverdeling-store.js`, `demand-forecast.js`)
 * en het WMS niet. Het WMS beantwoordt de vraag die het wél kan beantwoorden:
 * hoeveel van wat de keten mist, ligt hier daadwerkelijk vrij?
 *
 * Dat cijfer is niet triviaal en nergens anders te krijgen: SRS weet wel wat er
 * in het magazijn ligt, maar niet wat er al aan lopende pickopdrachten is
 * toegezegd. `wms.vrije_voorraad` weet dat wel. Zonder die correctie belooft een
 * adviesmodel dezelfde stuks aan twee winkels.
 *
 * De evenredige verdeling hieronder is dus een *schatting van haalbaarheid* per
 * winkel, geen opdracht. Opdrachten komen binnen via lib/koppeling.ts, van de
 * portal, die deze cijfers mag gebruiken om beter te beslissen.
 */

export interface AanvulRegel {
  branch_id: string;
  store: string;
  sku: string;
  omschrijving: string | null;
  maat: string | null;
  tekort: number;
  vrij: number;
  toegewezen: number;
  /** Wat de winkel nu heeft en zou moeten hebben — verklaart de voorrang. */
  aanwezig: number;
  ideaal: number;
}

export interface AanvulAdvies {
  regels: AanvulRegel[];
  perWinkel: { branch_id: string; store: string; regels: number; stuks: number }[];
  totaalTekort: number;
  totaalToegewezen: number;
  skusMetTekort: number;
  skusLeverbaar: number;
}

interface RuweRegel {
  branch_id: string;
  store: string;
  sku: string;
  tekort: number;
  aanwezig: number;
  ideaal: number;
  omschrijving: string | null;
  maat: string | null;
}

/**
 * Hoe dringend is dit tekort voor déze winkel?
 *
 * Absoluut tekort alleen is een slechte maatstaf. Een winkel met ideaal 20 en
 * twaalf op voorraad heeft acht tekort maar verkoopt gewoon door; een winkel met
 * ideaal 2 en niks op voorraad heeft twee tekort en staat met lege handen. Die
 * tweede hoort voor te gaan.
 *
 * Vandaar een factor tussen 1 en 2: helemaal leeg telt dubbel, bijna vol telt
 * enkel. Geen scherpere weging, want dit is een benadering van vraag — de échte
 * verkoopsnelheid per winkel zit in de portal en niet hier.
 */
function urgentie(r: { aanwezig: number; ideaal: number }): number {
  const ideaal = Number(r.ideaal) || 0;
  if (ideaal <= 0) return 1;
  const dekking = Math.min(Math.max(Number(r.aanwezig) / ideaal, 0), 1);
  return 1 + (1 - dekking);
}

interface Vraag {
  /** Bovengrens: nooit meer toewijzen dan een winkel tekortkomt. */
  gevraagd: number;
  /** Verdeelsleutel: tekort maal urgentie. */
  gewicht: number;
}

/**
 * Verdeelt `beschikbaar` stuks over de vragers naar gewicht, met het gevraagde
 * aantal als harde bovengrens.
 *
 * Grootste-resten-methode: eerst ieder zijn hele deel, daarna gaan de
 * overgebleven stuks naar wie de grootste breuk overhield. Zo blijft de som
 * exact gelijk aan wat er ligt — bij gewoon afronden verdwijnen er stuks, en dat
 * merk je pas als de picker er eentje overhoudt.
 *
 * Gewicht en bovengrens zijn bewust twee dingen. Ze samenvoegen zou betekenen
 * dat een winkel met een hoge urgentie méér krijgt dan hij tekortkomt, en dan
 * staat er straks voorraad in een winkel die er niet om vroeg.
 */
function verdeel(vragen: Vraag[], beschikbaar: number): number[] {
  const totaalGevraagd = vragen.reduce((s, v) => s + v.gevraagd, 0);
  const totaalGewicht = vragen.reduce((s, v) => s + v.gewicht, 0);

  if (totaalGevraagd === 0 || beschikbaar <= 0) return vragen.map(() => 0);
  if (beschikbaar >= totaalGevraagd) return vragen.map((v) => v.gevraagd);
  if (totaalGewicht === 0) return vragen.map(() => 0);

  const exact = vragen.map((v) =>
    Math.min((v.gewicht * beschikbaar) / totaalGewicht, v.gevraagd)
  );
  const toegewezen = exact.map((e) => Math.floor(e));
  let rest = beschikbaar - toegewezen.reduce((s, v) => s + v, 0);

  const opRest = exact
    .map((e, i) => ({ i, rest: e - Math.floor(e) }))
    .sort((a, b) => b.rest - a.rest);

  /* Meerdere rondes: door het afkappen op `gevraagd` kan er na de eerste ronde
     nog voorraad over zijn die een andere winkel wél kwijt kan. */
  let vorigeRest = -1;
  while (rest > 0 && rest !== vorigeRest) {
    vorigeRest = rest;
    for (const { i } of opRest) {
      if (rest <= 0) break;
      if (toegewezen[i] < vragen[i].gevraagd) {
        toegewezen[i] += 1;
        rest -= 1;
      }
    }
  }
  return toegewezen;
}

/** Berekent het advies. Schrijft niets. */
export async function aanvulAdvies(minimum = 1): Promise<AanvulAdvies> {
  const laatste = await queryOne<{ gen: string }>(
    `SELECT gen FROM public.srs_stock ORDER BY created_at DESC LIMIT 1`
  );
  if (!laatste?.gen) {
    return {
      regels: [],
      perWinkel: [],
      totaalTekort: 0,
      totaalToegewezen: 0,
      skusMetTekort: 0,
      skusLeverbaar: 0,
    };
  }

  /* Alleen sku's waar het magazijn iets van vrij heeft: de rest is inkoopwerk,
     geen magazijnwerk, en hoort niet op een looplijst.
     `aanwezig` en `ideaal` komen mee omdat de verdeling ze nodig heeft — zie
     `urgentie()` hieronder. */
  const ruw = await query<RuweRegel>(
    `WITH vrij AS (
       SELECT sku, sum(vrij)::int AS vrij
         FROM wms.vrije_voorraad
        WHERE vrij > 0 AND kind <> 'outbound'
        GROUP BY sku
     )
     SELECT s.branch_id, s.store, s.sku,
            sum(s.tekort)::int AS tekort,
            sum(s.qty)::int    AS aanwezig,
            sum(s.ideaal)::int AS ideaal,
            a.omschrijving, a.maat
       FROM public.srs_stock s
       JOIN vrij v ON v.sku = s.sku
       LEFT JOIN wms.artikelen a ON a.sku = s.sku
      WHERE s.gen = $1 AND s.branch_id <> '99' AND s.tekort > 0
      GROUP BY s.branch_id, s.store, s.sku, a.omschrijving, a.maat
      ORDER BY s.sku, s.branch_id`,
    [laatste.gen]
  );

  const vrijPerSku = new Map<string, number>(
    (
      await query<{ sku: string; vrij: number }>(
        `SELECT sku, sum(vrij)::int AS vrij
           FROM wms.vrije_voorraad
          WHERE vrij > 0 AND kind <> 'outbound'
          GROUP BY sku`
      )
    ).map((r) => [r.sku, Number(r.vrij)])
  );

  /* Per sku verdelen over de winkels die erom vragen. */
  const perSku = new Map<string, RuweRegel[]>();
  for (const r of ruw) {
    const lijst = perSku.get(r.sku);
    if (lijst) lijst.push(r);
    else perSku.set(r.sku, [r]);
  }

  const regels: AanvulRegel[] = [];
  for (const [sku, vragers] of perSku) {
    const beschikbaar = vrijPerSku.get(sku) ?? 0;
    const verdeling = verdeel(
      vragers.map((v) => ({
        gevraagd: Number(v.tekort),
        gewicht: Number(v.tekort) * urgentie(v),
      })),
      beschikbaar
    );
    vragers.forEach((v, i) => {
      if (verdeling[i] < minimum) return;
      regels.push({
        branch_id: v.branch_id,
        store: v.store,
        sku,
        omschrijving: v.omschrijving,
        maat: v.maat,
        tekort: Number(v.tekort),
        vrij: beschikbaar,
        toegewezen: verdeling[i],
        aanwezig: Number(v.aanwezig),
        ideaal: Number(v.ideaal),
      });
    });
  }

  regels.sort(
    (a, b) => a.store.localeCompare(b.store) || b.toegewezen - a.toegewezen
  );

  const perWinkelMap = new Map<string, { branch_id: string; store: string; regels: number; stuks: number }>();
  for (const r of regels) {
    const huidig = perWinkelMap.get(r.store) ?? {
      branch_id: r.branch_id,
      store: r.store,
      regels: 0,
      stuks: 0,
    };
    huidig.regels += 1;
    huidig.stuks += r.toegewezen;
    perWinkelMap.set(r.store, huidig);
  }

  return {
    regels,
    perWinkel: [...perWinkelMap.values()].sort((a, b) => b.stuks - a.stuks),
    totaalTekort: ruw.reduce((s, r) => s + Number(r.tekort), 0),
    totaalToegewezen: regels.reduce((s, r) => s + r.toegewezen, 0),
    skusMetTekort: perSku.size,
    skusLeverbaar: new Set(regels.map((r) => r.sku)).size,
  };
}

/* Bewust géén `maakAanvulOpdrachten` hier. Het omzetten van dekking naar echte
   opdrachten is een beslissing, en die hoort in de portal. Die stuurt het
   resultaat vervolgens naar POST /api/koppeling/opdracht met bron 'aanvulling'
   of 'herverdeling' — zie lib/koppeling.ts. */
