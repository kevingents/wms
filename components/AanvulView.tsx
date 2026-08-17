"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Kaart, Knop, Melding, Kental, LeegState } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { AanvulRegel } from "@/lib/aanvullen";

/**
 * Winkelaanvulling — de looplijst naar de filialen.
 *
 * SRS houdt per winkel een ideaal bij en berekent het tekort. Dat is de vraag.
 * Wat dit scherm toevoegt is het antwoord op "en kunnen we dat leveren": het
 * tekort afgezet tegen de vrije magazijnvoorraad, eerlijk verdeeld als meerdere
 * winkels hetzelfde vragen.
 *
 * WAAROM ER MAAR EEN DEEL OP DE LIJST STAAT
 * -----------------------------------------
 * Over de hele keten staat er tienduizenden stuks tekort, en het magazijn kan er
 * maar een fractie van leveren. Een lijst met alle tekorten laat iemand een uur
 * lopen voor vakken die leeg zijn. Hier staat alleen wat er écht ligt.
 *
 * De verdeling gaat evenredig naar tekort met de grootste-resten-methode: geen
 * stuk gaat verloren aan afronding, en een kleine winkel valt niet stelselmatig
 * buiten de boot omdat een grote sneller vraagt.
 */

interface Advies {
  minimum: number;
  regels: AanvulRegel[];
  perWinkel: { branch_id: string; store: string; regels: number; stuks: number }[];
  totaalTekort: number;
  totaalToegewezen: number;
  skusMetTekort: number;
  skusLeverbaar: number;
}

export function AanvulView({ magBeheren }: { magBeheren: boolean }) {
  const router = useRouter();
  const [advies, setAdvies] = useState<Advies | null>(null);
  const [gekozen, setGekozen] = useState<string[]>([]);
  const [openWinkel, setOpenWinkel] = useState<string | null>(null);
  const [laden, setLaden] = useState(true);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState("");
  const [melding, setMelding] = useState("");

  async function haalAdvies() {
    setLaden(true);
    setFout("");
    try {
      const res = await fetch("/api/aanvullen");
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Advies ophalen mislukt.");
        return;
      }
      setAdvies(data);
    } catch {
      setFout("Geen verbinding met de server.");
    } finally {
      setLaden(false);
    }
  }

  useEffect(() => {
    void haalAdvies();
  }, []);

  async function maakOpdrachten() {
    if (gekozen.length === 0) return;
    setBezig(true);
    setFout("");
    setMelding("");
    try {
      const res = await fetch("/api/aanvullen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stores: gekozen }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Opdrachten maken mislukt.");
        return;
      }
      const gemaakt = (data.gemaakt as string[])?.length ?? 0;
      const over = (data.overgeslagen as string[])?.length ?? 0;
      setMelding(
        gemaakt === 0
          ? "Geen nieuwe opdrachten — deze winkels hadden er vandaag al een."
          : `${gemaakt} pickopdracht${gemaakt === 1 ? "" : "en"} gemaakt.` +
              (over > 0 ? ` ${over} overgeslagen (had al een ronde vandaag).` : "")
      );
      setGekozen([]);
      await haalAdvies();
      router.refresh();
    } catch {
      setFout("Geen verbinding met de server.");
    } finally {
      setBezig(false);
    }
  }

  if (laden) {
    return (
      <Kaart>
        <p className="text-sm text-slate">Advies wordt berekend…</p>
      </Kaart>
    );
  }

  if (fout && !advies) {
    return <Melding soort="bad">{fout}</Melding>;
  }

  const leverbaar = advies?.totaalToegewezen ?? 0;
  const dekking =
    advies && advies.totaalTekort > 0
      ? Math.round((advies.totaalToegewezen / advies.totaalTekort) * 100)
      : 0;

  return (
    <div className="space-y-4">
      {melding && <Melding soort="ok">{melding}</Melding>}
      {fout && <Melding soort="bad">{fout}</Melding>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kental
          label="Nu leverbaar"
          waarde={leverbaar.toLocaleString("nl-NL")}
          soort={leverbaar > 0 ? "ok" : "warn"}
          toelichting="stuks die echt liggen"
        />
        <Kental
          label="Tekort in winkels"
          waarde={(advies?.totaalTekort ?? 0).toLocaleString("nl-NL")}
          toelichting={`${advies?.skusMetTekort ?? 0} sku's`}
        />
        <Kental
          label="Dekking"
          waarde={`${dekking}%`}
          soort={dekking > 50 ? "ok" : dekking > 15 ? "warn" : "bad"}
          toelichting="rest is inkoopwerk"
        />
        <Kental
          label="Winkels"
          waarde={advies?.perWinkel.length ?? 0}
          toelichting="met leverbaar tekort"
        />
      </div>

      {leverbaar === 0 && (
        <Melding soort="warn">
          Het magazijn kan op dit moment niets leveren van wat de winkels tekortkomen.
          Dat komt doordat er nog geen voorraad in het WMS staat — de locaties zijn er,
          maar leeg. Zodra de beginvoorraad geladen is, vult deze lijst zich vanzelf.
        </Melding>
      )}

      <Kaart
        titel={`Looplijst per winkel (${advies?.perWinkel.length ?? 0})`}
        actie={
          <div className="flex gap-2">
            <Knop variant="secundair" onClick={haalAdvies} disabled={bezig}>
              <Icon name="synchroniseer" size={16} />
              Opnieuw rekenen
            </Knop>
            {magBeheren && gekozen.length > 0 && (
              <Knop onClick={maakOpdrachten} disabled={bezig}>
                <Icon name="pick" size={16} />
                {bezig ? "Bezig…" : `${gekozen.length} ronde(s) maken`}
              </Knop>
            )}
          </div>
        }
      >
        {!advies || advies.perWinkel.length === 0 ? (
          <LeegState tekst="Geen winkel heeft op dit moment een tekort dat het magazijn kan dekken." />
        ) : (
          <>
            <p className="mb-3 text-sm text-slate">
              Vink de winkels aan die je vandaag aanvult. Elke winkel wordt één
              pickopdracht, die je daarna in een ronde met bakken kunt meenemen.
            </p>
            <ul className="divide-y divide-navy-100">
              {advies.perWinkel.map((w) => {
                const aan = gekozen.includes(w.store);
                const uitgeklapt = openWinkel === w.store;
                const regels = advies.regels.filter((r) => r.store === w.store);
                return (
                  <li key={w.store}>
                    <div className="flex items-center gap-3 py-3">
                      {magBeheren && (
                        <button
                          type="button"
                          onClick={() =>
                            setGekozen((g) =>
                              aan ? g.filter((s) => s !== w.store) : [...g, w.store]
                            )
                          }
                          aria-label={aan ? "Niet aanvullen" : "Wel aanvullen"}
                          className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2",
                            aan
                              ? "border-navy bg-navy text-white"
                              : "border-navy-100 text-slate"
                          )}
                        >
                          {aan && <Icon name="vink" size={18} />}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setOpenWinkel(uitgeklapt ? null : w.store)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-navy">
                            {w.store}
                          </span>
                          <span className="block text-sm text-slate">
                            {w.stuks} stuks over {w.regels} regel{w.regels === 1 ? "" : "s"}
                          </span>
                        </span>
                        <Icon
                          name="pijl"
                          size={18}
                          className={cn(
                            "shrink-0 text-slate transition-transform",
                            uitgeklapt && "rotate-90"
                          )}
                        />
                      </button>
                    </div>

                    {uitgeklapt && (
                      <ul className="mb-3 space-y-1 rounded-lg bg-navy-50 p-2">
                        {regels.map((r) => (
                          <li
                            key={`${r.store}-${r.sku}`}
                            className="flex items-center gap-3 text-sm"
                          >
                            <span className="w-8 shrink-0 text-right font-bold tabular-nums">
                              {r.toegewezen}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">
                                {r.omschrijving || r.sku}
                              </span>
                              <span className="block truncate font-mono text-xs text-slate">
                                {r.sku}
                                {r.maat ? ` · ${r.maat}` : ""}
                              </span>
                            </span>
                            {/* Wat de winkel nu heeft tegenover wat hij hoort te
                                hebben — dát verklaart waarom deze regel voorrang
                                kreeg, en niet het kale tekort. */}
                            <span className="shrink-0 text-right text-xs text-slate">
                              <span className="block">
                                vraagt {r.tekort} · {r.vrij} vrij
                              </span>
                              {r.ideaal > 0 && (
                                <span
                                  className={
                                    r.aanwezig === 0 ? "block font-semibold text-bad" : "block"
                                  }
                                >
                                  winkel heeft {r.aanwezig}/{r.ideaal}
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Kaart>

      <Kaart titel="Waarom staat hier niet alles?">
        <p className="text-sm text-slate">
          De winkels komen samen{" "}
          <span className="font-semibold text-navy">
            {(advies?.totaalTekort ?? 0).toLocaleString("nl-NL")} stuks
          </span>{" "}
          tekort, maar het magazijn kan er{" "}
          <span className="font-semibold text-navy">
            {leverbaar.toLocaleString("nl-NL")}
          </span>{" "}
          van leveren. De rest is niet iets om te lopen maar om te bestellen — dat is
          inkoopwerk en hoort bij de portal, niet hier.
        </p>
        <p className="mt-2 text-sm text-slate">
          Vraagt meer dan één winkel hetzelfde artikel, dan wordt het verdeeld naar
          tekort én naar hoe leeg de winkel staat. Een filiaal met nul op voorraad
          telt dubbel ten opzichte van een filiaal dat bijna vol is — die eerste
          verkoopt niets meer, die tweede draait gewoon door. Wie het eerst vraagt
          krijgt dus niet alles.
        </p>
        <p className="mt-2 rounded-lg bg-navy-50 px-3 py-2 text-sm text-slate">
          <span className="font-semibold text-navy">Let op: </span>
          deze verdeling weegt alleen het tekort. De portal kan er verkoopsnelheid en
          herverdeling bij betrekken en stuurt het resultaat dan als opdracht naar het
          magazijn. Zolang die knop daar nog niet zit, is dit scherm de kortste weg —
          maar het is niet hetzelfde advies.
        </p>
      </Kaart>
    </div>
  );
}
