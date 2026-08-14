"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Kaart, Knop, Melding, Kental, LeegState } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type {
  Sluitcontrole,
  GrootboekBalans,
  ZoneWaarde,
  OntbrekendeWaarde,
  Periode,
  ArtikelKlasse,
} from "@/lib/financieel";

/**
 * Het financiële scherm.
 *
 * Bovenaan staat het enige getal dat er echt toe doet: sluit de voorraadwaarde
 * met zichzelf. Zo niet, dan is er buiten het systeem om geboekt en heeft de
 * rest van de pagina geen betekenis — vandaar dat alles daaronder pas komt.
 */

const MAANDEN = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

function euro(cent: number) {
  return (cent / 100).toLocaleString("nl-NL", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}

function euroExact(cent: number) {
  return (cent / 100).toLocaleString("nl-NL", { style: "currency", currency: "EUR" });
}

export function FinancieelView({
  controle,
  balans,
  zones,
  ontbreekt,
  perioden,
  slotting,
  magBeheren,
  glIngesteld,
}: {
  controle: Sluitcontrole;
  balans: GrootboekBalans[];
  zones: ZoneWaarde[];
  ontbreekt: OntbrekendeWaarde[];
  perioden: Periode[];
  slotting: ArtikelKlasse[];
  magBeheren: boolean;
  glIngesteld: boolean;
}) {
  const router = useRouter();
  const [fout, setFout] = useState("");
  const [melding, setMelding] = useState("");
  const [bezig, setBezig] = useState(false);

  async function actie(body: Record<string, unknown>) {
    setBezig(true);
    setFout("");
    setMelding("");
    try {
      const res = await fetch("/api/financieel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Actie mislukt.");
        return null;
      }
      router.refresh();
      return data;
    } catch {
      setFout("Geen verbinding met de server.");
      return null;
    } finally {
      setBezig(false);
    }
  }

  async function importeer() {
    const data = await actie({ actie: "import-kostprijzen" });
    if (data) {
      setMelding(
        `${data.gezet} kostprijzen bijgewerkt van ${data.gevonden} gevonden (${data.overgeslagen} ongewijzigd of leeg).`
      );
    }
  }

  async function sluit(p: Periode) {
    const akkoord = window.confirm(
      `${MAANDEN[p.maand - 1]} ${p.jaar} afsluiten? Daarna kan er niets meer in geboekt worden.`
    );
    if (!akkoord) return;
    const data = await actie({ actie: "sluit-periode", jaar: p.jaar, maand: p.maand });
    if (data) setMelding(`${MAANDEN[p.maand - 1]} ${p.jaar} is afgesloten.`);
  }

  async function heropen(p: Periode) {
    const reden = window.prompt(
      `Waarom moet ${MAANDEN[p.maand - 1]} ${p.jaar} weer open? Dit wordt vastgelegd.`
    );
    if (!reden?.trim()) return;
    const data = await actie({
      actie: "heropen-periode",
      jaar: p.jaar,
      maand: p.maand,
      reden,
    });
    if (data) setMelding("Periode heropend.");
  }

  const totaleWaarde = zones.reduce((s, z) => s + Number(z.waarde_cent ?? 0), 0);
  const balansScheef = balans.filter((b) => Number(b.verschil_cent) !== 0);

  return (
    <div className="space-y-6">
      {melding && <Melding soort="ok">{melding}</Melding>}
      {fout && <Melding soort="bad">{fout}</Melding>}

      {/* ── De sluitcontrole ─────────────────────────────────────────────── */}
      <Kaart titel="Sluit de voorraadwaarde?">
        <p className="mb-3 text-sm text-slate">
          Alles wat er ooit binnenkwam, min alles wat eruit ging, hoort exact gelijk te
          zijn aan wat er nu ligt. Wijkt dat af, dan is er buiten het systeem om geboekt.
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kental label="Waarde in" waarde={euro(controle.waarde_in_cent)} />
          <Kental label="Waarde uit" waarde={euro(controle.waarde_uit_cent)} />
          <Kental
            label="Op voorraad"
            waarde={euro(controle.waarde_op_voorraad_cent)}
            soort="neutraal"
          />
          <Kental
            label="Verschil"
            waarde={euroExact(controle.verschil_cent)}
            soort={controle.sluit ? "ok" : "bad"}
            toelichting={controle.sluit ? "sluit" : "onderzoeken"}
          />
        </div>
        {!controle.sluit && (
          <Melding soort="bad">
            De administratie sluit niet. Dit kan alleen ontstaan door rechtstreeks in de
            database te schrijven — zoek uit wat dat deed voordat je hierop verdergaat.
          </Melding>
        )}
      </Kaart>

      {!glIngesteld && (
        <Melding soort="warn">
          Er zijn nog geen grootboekrekeningen ingesteld, dus er worden geen journaalposten
          klaargezet. De waardering loopt wel gewoon door — vul de rekeningen in bij
          Instellingen en genereer daarna opnieuw.
        </Melding>
      )}

      {/* ── Waarde ──────────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Kaart titel={`Voorraadwaarde per zone — ${euro(totaleWaarde)}`}>
          {zones.length === 0 ? (
            <LeegState tekst="Nog geen gewaardeerde voorraad." />
          ) : (
            <ul className="space-y-1.5">
              {zones.map((z) => (
                <li key={z.zone} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 truncate font-medium">{z.zone}</span>
                  <span className="flex h-4 flex-1 overflow-hidden rounded bg-navy-50">
                    <span
                      className="h-full bg-navy"
                      style={{
                        width: `${totaleWaarde ? (Number(z.waarde_cent) / totaleWaarde) * 100 : 0}%`,
                      }}
                    />
                  </span>
                  <span className="w-24 shrink-0 text-right font-semibold tabular-nums">
                    {euro(Number(z.waarde_cent))}
                  </span>
                  <span className="hidden w-20 shrink-0 text-right text-xs text-slate sm:block">
                    {z.stuks} stuks
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Kaart>

        <Kaart
          titel={`Voorraad zonder kostprijs (${ontbreekt.length})`}
          actie={
            magBeheren && (
              <Knop variant="secundair" onClick={importeer} disabled={bezig}>
                <Icon name="synchroniseer" size={16} />
                {bezig ? "Bezig…" : "Kostprijzen ophalen"}
              </Knop>
            )
          }
        >
          {ontbreekt.length === 0 ? (
            <Melding soort="ok">
              Alle voorraad is gewaardeerd. De voorraadwaarde is compleet.
            </Melding>
          ) : (
            <>
              <p className="mb-2 text-xs text-slate">
                Deze artikelen liggen er wel maar tellen voor nul euro mee. Elk artikel
                hier is een gat in de balans.
              </p>
              <ul className="divide-y divide-navy-100">
                {ontbreekt.slice(0, 12).map((o) => (
                  <li key={o.sku} className="flex items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{o.omschrijving || o.sku}</span>
                      <span className="block font-mono text-xs text-slate">{o.sku}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-slate">
                      {o.stuks} stuks
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Kaart>
      </div>

      {/* ── Grootboek ───────────────────────────────────────────────────── */}
      <Kaart titel="Grootboek in balans">
        <p className="mb-2 text-xs text-slate">
          Dubbel boekhouden: debet min credit hoort per maand nul te zijn. Dat is de
          tweede sluitcontrole, los van de voorraad.
        </p>
        {balans.length === 0 ? (
          <LeegState tekst="Nog geen journaalposten klaargezet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-100 text-left text-xs uppercase tracking-wide text-slate">
                  <th className="py-2 pr-3 font-semibold">Periode</th>
                  <th className="py-2 pr-3 text-right font-semibold">Debet</th>
                  <th className="py-2 pr-3 text-right font-semibold">Credit</th>
                  <th className="py-2 pr-3 text-right font-semibold">Verschil</th>
                  <th className="py-2 text-right font-semibold">Regels</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {balans.map((b) => (
                  <tr key={`${b.jaar}-${b.maand}`}>
                    <td className="py-2 pr-3">
                      {MAANDEN[b.maand - 1]} {b.jaar}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {euro(Number(b.debet_cent))}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {euro(Number(b.credit_cent))}
                    </td>
                    <td
                      className={cn(
                        "py-2 pr-3 text-right font-semibold tabular-nums",
                        Number(b.verschil_cent) === 0 ? "text-ok" : "text-bad"
                      )}
                    >
                      {euroExact(Number(b.verschil_cent))}
                    </td>
                    <td className="py-2 text-right tabular-nums text-slate">
                      {b.regels}
                      {b.verstuurd > 0 && (
                        <span className="ml-1 text-xs">({b.verstuurd} verstuurd)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {balansScheef.length > 0 && (
          <Melding soort="bad">
            {balansScheef.length} periode(n) niet in balans. Journaalposten worden per
            gebeurtenis in paren gemaakt, dus dit hoort niet voor te komen.
          </Melding>
        )}
      </Kaart>

      {/* ── Perioden ────────────────────────────────────────────────────── */}
      <Kaart titel="Perioden">
        <p className="mb-2 text-xs text-slate">
          Een afgesloten maand kan niet meer bewegen — de database weigert de boeking.
          Zonder dat slot kan een boeking van vandaag de cijfers van vorige maand
          veranderen nadat de accountant ernaar keek.
        </p>
        <ul className="divide-y divide-navy-100">
          {perioden.map((p) => (
            <li
              key={`${p.jaar}-${p.maand}`}
              className="flex items-center gap-3 py-2 text-sm"
            >
              <span className="w-32 shrink-0 font-medium">
                {MAANDEN[p.maand - 1]} {p.jaar}
              </span>
              <span className="min-w-0 flex-1 text-slate">
                {p.mutaties} mutaties · {euro(Number(p.waarde_in_cent))} in ·{" "}
                {euro(Number(p.waarde_uit_cent))} uit
              </span>
              {p.status === "afgesloten" ? (
                <>
                  <span className="shrink-0 rounded bg-ok-100 px-2 py-0.5 text-xs text-ok">
                    afgesloten
                  </span>
                  {magBeheren && (
                    <button
                      type="button"
                      onClick={() => heropen(p)}
                      disabled={bezig}
                      className="shrink-0 text-xs text-slate underline underline-offset-2"
                    >
                      heropenen
                    </button>
                  )}
                </>
              ) : (
                magBeheren && (
                  <Knop variant="secundair" onClick={() => sluit(p)} disabled={bezig}>
                    Afsluiten
                  </Knop>
                )
              )}
            </li>
          ))}
        </ul>
      </Kaart>

      {/* ── Slotting ────────────────────────────────────────────────────── */}
      <Kaart titel={`Hardlopers die achterin liggen (${slotting.length})`}>
        <p className="mb-2 text-xs text-slate">
          A-artikelen zijn samen 80% van het pickvolume. Liggen die in de achterste helft
          van het magazijn, dan loopt de picker dat traject elke dag opnieuw. Dit is het
          enige optimalisatie-advies dat het WMS zelf geeft — het volgt puur uit
          pickhistorie en looproute.
        </p>
        {slotting.length === 0 ? (
          <LeegState tekst="Geen hardlopers op een ongunstige plek. Of er is nog te weinig pickhistorie." />
        ) : (
          <ul className="divide-y divide-navy-100">
            {slotting.map((a) => (
              <li key={a.sku} className="flex items-center gap-3 py-2 text-sm">
                <span className="shrink-0 rounded bg-navy px-2 py-0.5 text-xs font-bold text-white">
                  {a.klasse}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{a.omschrijving || a.sku}</span>
                  <span className="block truncate font-mono text-xs text-slate">
                    ligt op {a.locaties ?? "onbekend"}
                  </span>
                </span>
                <span className="shrink-0 text-right tabular-nums text-slate">
                  {a.stuks} gepikt
                </span>
              </li>
            ))}
          </ul>
        )}
      </Kaart>
    </div>
  );
}
