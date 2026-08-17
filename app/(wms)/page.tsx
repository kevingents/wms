import Link from "next/link";
import { kerncijfers, recenteBoekingen, shadowSamenvatting } from "@/lib/voorraad";
import { doorvoer, werkstand } from "@/lib/kpi";
import { instelling } from "@/lib/instellingen";
import { query } from "@/lib/db";
import { Kaart, Kental, LeegState } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import { REDEN_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Het dagoverzicht — voor de teamleider die 's ochtends binnenkomt.
 *
 * De volgorde ís de boodschap: eerst wat er open staat, dan wat er knelt, dan
 * wat er vandaag doorheen ging. Voorraadstand en het SRS-verschil staan bewust
 * onderaan. Ze zijn belangrijk, maar ze veranderen niet wat je als eerste
 * oppakt, en wat je als eerste oppakt is waar dit scherm voor bestaat.
 *
 * Elk blok is een deur: het getal zegt dát er werk is, de link brengt je naar de
 * plek waar je het doet. Een dashboard waar je niets vanuit kunt, laat je twee
 * keer zoeken.
 *
 * Alles hier verdraagt een leeg magazijn — dit systeem begint met nul boekingen,
 * en een overzicht dat dan stukloopt of alleen maar streepjes toont is precies
 * op het verkeerde moment nutteloos.
 */

type Ernst = "info" | "let_op" | "urgent";

interface OpenSignaal {
  id: number;
  ernst: Ernst;
  titel: string;
  toelichting: string | null;
  created_at: string;
}

interface SignaalRij extends OpenSignaal {
  totaal_open: number;
  totaal_urgent: number;
}

/**
 * De open signalen. Alleen lezen, met de tellingen als vensterfunctie erbij —
 * het scherm heeft zowel de bovenste zes als het totaal nodig, en dat is één
 * vraag aan de database waard in plaats van twee.
 */
async function openSignalen(limiet = 6) {
  const rijen = await query<SignaalRij>(
    `SELECT id, ernst, titel, toelichting, created_at,
            (count(*) OVER ())::int                                   AS totaal_open,
            (count(*) FILTER (WHERE ernst = 'urgent') OVER ())::int   AS totaal_urgent
       FROM wms.signalen
      WHERE status = 'open'
      ORDER BY CASE ernst WHEN 'urgent' THEN 0 WHEN 'let_op' THEN 1 ELSE 2 END,
               created_at DESC
      LIMIT $1`,
    [limiet]
  );
  return {
    regels: rijen as OpenSignaal[],
    open: rijen[0]?.totaal_open ?? 0,
    urgent: rijen[0]?.totaal_urgent ?? 0,
  };
}

type Soort = "neutraal" | "ok" | "warn" | "bad";

const ERNST_SOORT: Record<Ernst, Soort> = {
  info: "neutraal",
  let_op: "warn",
  urgent: "bad",
};

const ERNST_LABEL: Record<Ernst, string> = {
  info: "Info",
  let_op: "Let op",
  urgent: "Urgent",
};

function tijd(iso: string) {
  return new Date(iso).toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  });
}

function datumTijd(iso: string) {
  return new Date(iso).toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  });
}

/** Dagsleutel zoals lib/kpi.ts hem maakt: de kalenderdag in Amsterdam. */
function dagSleutel(d: Date) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam" }).format(d);
}

function weekdag(dag: string) {
  return new Date(`${dag}T12:00:00Z`).toLocaleDateString("nl-NL", {
    weekday: "short",
    timeZone: "UTC",
  });
}

function MeerLink({ href, tekst }: { href: string; tekst: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1 text-sm font-medium text-navy underline underline-offset-2"
    >
      {tekst} <Icon name="pijl" size={14} />
    </Link>
  );
}

/** Kental dat ergens heen brengt. De hele tegel is raakvlak, niet alleen de tekst. */
function Tegel({
  href,
  label,
  waarde,
  toelichting,
  soort,
}: {
  href: string;
  label: string;
  waarde: string | number;
  toelichting?: string;
  soort?: Soort;
}) {
  return (
    <Link href={href} className="block rounded-xl active:opacity-80">
      <Kental label={label} waarde={waarde} toelichting={toelichting} soort={soort} />
    </Link>
  );
}

export default async function Overzicht() {
  const [cijfers, stand, dagen, signalen, shadow, boekingen, shadowAlarm, pickAlarm] =
    await Promise.all([
      kerncijfers(),
      werkstand(),
      doorvoer(7),
      openSignalen(6),
      shadowSamenvatting(),
      recenteBoekingen(10),
      instelling<number>("shadow.diff_alarm"),
      instelling<number>("bewaking.pick_uren_alarm"),
    ]);

  const shadowDrempel = Number(shadowAlarm) || 10;
  const pickDrempel = Number(pickAlarm) || 24;

  const shadowSoort: Soort =
    shadow.skus_met_verschil === 0
      ? "ok"
      : shadow.skus_met_verschil > shadowDrempel
        ? "bad"
        : "warn";

  /* De week wordt uit vaste dagsleutels opgebouwd en niet uit de queryrijen:
     een dag zonder boekingen levert geen rij op, en juist die lege dag wil je
     in de strook zien staan. Twaalf uur UTC als anker, zodat de zomertijd de
     dagen niet één opschuift. */
  const vandaagSleutel = dagSleutel(new Date());
  const anker = new Date(`${vandaagSleutel}T12:00:00Z`);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(anker);
    d.setUTCDate(d.getUTCDate() - (6 - i));
    const sleutel = d.toISOString().slice(0, 10);
    return dagen.find((r) => r.dag === sleutel) ?? {
      dag: sleutel,
      boekingen: 0,
      stuks: 0,
      ontvangen: 0,
      gepikt: 0,
      verzonden: 0,
      geteld: 0,
    };
  });
  const maxStuks = Math.max(...week.map((d) => d.stuks), 1);
  const vandaag = week[week.length - 1];

  const pickWerk = stand.pick_open + stand.pick_bezig;
  const pickSoort: Soort =
    stand.oudste_pick_uren === null
      ? "neutraal"
      : stand.oudste_pick_uren > pickDrempel
        ? "bad"
        : stand.oudste_pick_uren > pickDrempel / 3
          ? "warn"
          : "ok";

  /* Een magazijn zonder voorraad is geen storing maar een systeem dat nog moet
     beginnen. Dan is de enige nuttige inhoud van dit scherm: wat is de volgende
     stap. */
  const nogLeeg = cijfers.stuks === 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-navy">Overzicht</h1>
        <p className="text-sm text-slate">
          Waar het magazijn nu staat en waar het knelt. SRS draait er nog naast — zie
          SRS-check onderaan.
        </p>
      </header>

      {nogLeeg && (
        <Kaart
          titel="Aan de slag"
          actie={<MeerLink href="/help" tekst="Handleiding" />}
        >
          <p className="mb-3 text-sm text-slate">
            Er ligt nog niets in het WMS. Eerst kloppen op totaal, dan verfijnen op
            locatie — in die volgorde, want andersom werk je wekenlang met een systeem
            dat niet klopt.
          </p>
          <ol className="space-y-2 text-sm">
            {[
              {
                pad: "/locaties",
                tekst: "Maak de locaties aan — zones, stellingen, vakken.",
                klaar: cijfers.locaties > 0,
              },
              {
                pad: "/inslag",
                tekst: "Laad de beginvoorraad uit SRS naar de wachtlocatie.",
                klaar: false,
              },
              {
                pad: "/scan",
                tekst: "Verhuis die voorraad scannend naar de echte vakken.",
                klaar: false,
              },
            ].map((stap, i) => (
              <li key={stap.pad}>
                <Link
                  href={stap.pad}
                  className="flex min-h-tap items-center gap-3 rounded-lg border border-navy-100 px-3"
                >
                  <span
                    className={
                      stap.klaar
                        ? "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ok-100 text-ok"
                        : "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-50 text-xs font-bold text-navy"
                    }
                  >
                    {stap.klaar ? <Icon name="vink" size={14} /> : i + 1}
                  </span>
                  <span className="flex-1">{stap.tekst}</span>
                  <Icon name="pijl" size={16} className="text-slate" />
                </Link>
              </li>
            ))}
          </ol>
        </Kaart>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate">
            Nu open
          </h2>
          <MeerLink href="/kpi" tekst="Cijfers" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tegel
            href="/picken"
            label="Pickwerk"
            waarde={pickWerk}
            toelichting={`${stand.pick_bezig} onderhanden`}
          />
          <Tegel
            href="/rondes"
            label="Rondes"
            waarde={stand.rondes_open}
            toelichting="karren onderweg"
          />
          <Tegel
            href="/inpakken"
            label="Inpakken"
            waarde={stand.zending_open}
            toelichting="dozen aan tafel"
          />
          <Tegel
            href="/taken"
            label="Taken"
            waarde={stand.taken_open}
            toelichting="aanvullen, tellen"
          />
          <Tegel
            href="/ontvangst"
            label="Ontvangst"
            waarde={stand.ontvangst_open}
            toelichting="leveringen open"
          />
          <Tegel
            href="/retouren"
            label="Retouren"
            waarde={stand.retour_open}
            toelichting="te beoordelen"
          />
          <Tegel
            href="/picken"
            label="Oudste pick"
            waarde={stand.oudste_pick_uren !== null ? `${stand.oudste_pick_uren} u` : "—"}
            soort={pickSoort}
            toelichting={`alarm boven ${pickDrempel} u`}
          />
          <Tegel
            href="/signalen"
            label="Signalen"
            waarde={signalen.open}
            soort={
              signalen.urgent > 0 ? "bad" : signalen.open > 0 ? "warn" : "ok"
            }
            toelichting={signalen.urgent > 0 ? `${signalen.urgent} urgent` : "open"}
          />
        </div>
      </section>

      <Kaart
        titel="Signalen"
        actie={<MeerLink href="/signalen" tekst="Alle signalen" />}
      >
        {signalen.regels.length === 0 ? (
          <LeegState tekst="Niets aan de hand — geen open signalen." />
        ) : (
          <ul className="divide-y divide-navy-100">
            {signalen.regels.map((s) => (
              <li key={s.id} className="flex items-start gap-3 py-2 text-sm">
                <Icon
                  name={s.ernst === "info" ? "klok" : "alert"}
                  size={18}
                  className={
                    ERNST_SOORT[s.ernst] === "bad"
                      ? "mt-0.5 text-bad"
                      : ERNST_SOORT[s.ernst] === "warn"
                        ? "mt-0.5 text-warn"
                        : "mt-0.5 text-slate"
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{s.titel}</span>
                  {s.toelichting && (
                    <span className="block text-xs text-slate">{s.toelichting}</span>
                  )}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-slate">
                    {ERNST_LABEL[s.ernst]}
                  </span>
                  <span className="block text-xs text-slate">
                    {datumTijd(s.created_at)}
                  </span>
                </span>
              </li>
            ))}
            {signalen.open > signalen.regels.length && (
              <li className="py-2 text-xs text-slate">
                Nog {signalen.open - signalen.regels.length} andere open.
              </li>
            )}
          </ul>
        )}
      </Kaart>

      <Kaart titel="Vandaag" actie={<MeerLink href="/kpi" tekst="Doorvoer" />}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kental label="Ontvangen" waarde={vandaag.ontvangen} toelichting="stuks in" />
          <Kental label="Gepikt" waarde={vandaag.gepikt} toelichting="stuks uit het schap" />
          <Kental label="Verzonden" waarde={vandaag.verzonden} toelichting="stuks de deur uit" />
          <Kental label="Geteld" waarde={vandaag.geteld} toelichting="telregels" />
        </div>

        <div className="mt-4 flex items-end gap-2">
          {week.map((d) => (
            <div key={d.dag} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[11px] tabular-nums text-slate">
                {d.stuks > 0 ? d.stuks : ""}
              </span>
              <span className="flex h-16 w-full items-end rounded bg-navy-50">
                <span
                  className="w-full rounded bg-navy"
                  style={{ height: `${(d.stuks / maxStuks) * 100}%` }}
                />
              </span>
              <span className="text-[11px] text-slate">{weekdag(d.dag)}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate">
          Stuks per dag, zeven dagen terug. Alles uit het grootboek zelf — wat geboekt
          is, is gedaan.
        </p>
      </Kaart>

      <Kaart titel="Voorraad" actie={<MeerLink href="/voorraad" tekst="Zoeken" />}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kental label="Stuks" waarde={cijfers.stuks.toLocaleString("nl-NL")} />
          <Kental label="Artikelen" waarde={cijfers.skus.toLocaleString("nl-NL")} />
          <Kental
            label="Locaties"
            waarde={cijfers.locaties}
            toelichting={`${cijfers.bezette_locaties} bezet`}
          />
          <Kental label="Boekingen vandaag" waarde={cijfers.boekingen_vandaag} />
        </div>
      </Kaart>

      <Kaart
        titel="Verschil met SRS"
        actie={<MeerLink href="/shadow" tekst="Bekijken" />}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kental
            label="SKU's met verschil"
            waarde={shadow.skus_met_verschil.toLocaleString("nl-NL")}
            soort={shadowSoort}
            toelichting={`drempel ${shadowDrempel}`}
          />
          <Kental
            label="Stuks verschil"
            waarde={shadow.stuks_verschil.toLocaleString("nl-NL")}
            soort={shadowSoort}
          />
          <Kental
            label="SRS magazijn"
            waarde={shadow.srs_stuks.toLocaleString("nl-NL")}
            toelichting={`${shadow.srs_skus} sku's`}
          />
          <Kental
            label="WMS magazijn"
            waarde={shadow.wms_stuks.toLocaleString("nl-NL")}
            toelichting={`${shadow.wms_skus} sku's`}
          />
        </div>
        {shadow.wms_stuks === 0 && (
          <p className="mt-3 rounded-lg bg-navy-50 px-3 py-2 text-sm text-slate">
            Het WMS is nog leeg. Maak eerst locaties aan en boek dan de beginvoorraad in
            — tot die tijd is het verschil met SRS logischerwijs het volledige magazijn.
          </p>
        )}
      </Kaart>

      <Kaart titel="Laatste boekingen" actie={<MeerLink href="/kpi" tekst="Historie" />}>
        {boekingen.length === 0 ? (
          <LeegState tekst="Nog geen boekingen." />
        ) : (
          <ul className="divide-y divide-navy-100">
            {boekingen.map((b) => (
              <li key={b.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-12 shrink-0 text-xs tabular-nums text-slate">
                  {tijd(b.created_at)}
                </span>
                <span className="w-10 shrink-0 text-right font-bold tabular-nums">
                  {b.qty}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {b.omschrijving || b.sku}
                  </span>
                  <span className="block truncate font-mono text-xs text-slate">
                    {b.van_code || "buiten"} → {b.naar_code || "buiten"}
                  </span>
                </span>
                <span className="shrink-0 rounded bg-navy-50 px-2 py-0.5 text-xs">
                  {REDEN_LABELS[b.reason] ?? b.reason}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Kaart>
    </div>
  );
}
