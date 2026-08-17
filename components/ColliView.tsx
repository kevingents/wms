"use client";

import { useEffect, useState } from "react";
import { ScanVeld } from "@/components/ScanVeld";
import { Kaart, Knop, Melding, Veld, LeegState, invoerClasses } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import { nieuweSleutel } from "@/lib/outbox";
import { cn } from "@/lib/cn";
import { COLLO_SOORTEN, type Collo, type ColloRegel, type ColloSoort, type CrossdockKans } from "@/lib/colli";

/**
 * Colli aan de kade.
 *
 * Waar dit zijn geld verdient: één collo vullen kost net zoveel scans als los
 * inboeken, maar het verplaatsen erna is één handeling in plaats van veertig.
 * Een pallet die van de kade naar een stelling gaat, is dus twee scans — label
 * en vak — en niet veertig.
 *
 * De paklijst ligt vast zodra het collo dicht is. Dat is met opzet: wat er in de
 * doos zit moet niet meer veranderen nadat iemand hem heeft gesloten, anders klopt
 * de verplaatsing niet met de werkelijkheid.
 */
export function ColliView({ startlocatie }: { startlocatie: string }) {
  const [colli, setColli] = useState<Collo[]>([]);
  const [kansen, setKansen] = useState<CrossdockKans[]>([]);
  const [actief, setActief] = useState<{ collo: Collo; regels: ColloRegel[] } | null>(null);

  const [soort, setSoort] = useState<ColloSoort>("doos");
  const [scanCode, setScanCode] = useState("");
  const [colloScan, setColloScan] = useState("");
  const [naarLocatie, setNaarLocatie] = useState("");
  const [fout, setFout] = useState("");
  const [melding, setMelding] = useState("");
  const [bezig, setBezig] = useState(false);

  async function laden() {
    const [a, b] = await Promise.all([
      fetch("/api/colli").then((r) => r.json()),
      fetch("/api/colli?crossdock=1").then((r) => r.json()),
    ]);
    if (a.ok) setColli(a.colli);
    if (b.ok) setKansen(b.kansen);
  }

  useEffect(() => {
    void laden();
  }, []);

  async function actie(body: Record<string, unknown>) {
    setBezig(true);
    setFout("");
    try {
      const res = await fetch("/api/colli", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Actie mislukt.");
        return null;
      }
      return data;
    } catch {
      setFout("Geen verbinding met de server.");
      return null;
    } finally {
      setBezig(false);
    }
  }

  async function open(id: number) {
    const res = await fetch(`/api/colli?id=${id}`);
    const data = await res.json();
    if (data.ok) {
      setActief({ collo: data.collo, regels: data.regels });
      setNaarLocatie("");
    }
  }

  async function zoekOpLabel(code: string) {
    setFout("");
    const res = await fetch(`/api/colli?code=${encodeURIComponent(code)}`);
    const data = await res.json();
    setColloScan("");
    if (!data.ok) {
      setFout(data.message || "Onbekend collo.");
      return;
    }
    setActief({ collo: data.collo, regels: data.regels });
  }

  async function nieuw() {
    const data = await actie({ actie: "nieuw", soort, locatieCode: startlocatie });
    if (data) {
      setMelding(`Collo ${data.collo.code} aangemaakt. Print het label en scan de inhoud.`);
      await laden();
      await open(data.collo.id);
    }
  }

  async function scanArtikel(code: string) {
    if (!actief) return;
    const data = await actie({ actie: "toevoegen", id: actief.collo.id, code, aantal: 1 });
    setScanCode("");
    if (data) {
      setActief({ collo: data.collo, regels: data.regels });
      setMelding("");
    }
  }

  async function verwijder(sku: string) {
    if (!actief) return;
    const data = await actie({ actie: "verwijderen", id: actief.collo.id, sku });
    if (data) setActief({ collo: data.collo, regels: data.regels });
  }

  async function sluit() {
    if (!actief) return;
    const data = await actie({ actie: "sluiten", id: actief.collo.id });
    if (data) {
      setActief({ collo: data.collo, regels: actief.regels });
      setMelding("Collo dicht. Scan het label bij het vak om alles in één keer te boeken.");
      await laden();
    }
  }

  async function verplaats() {
    if (!actief || !naarLocatie.trim()) return;
    const data = await actie({
      actie: "verplaatsen",
      id: actief.collo.id,
      naarLocatieCode: naarLocatie.trim(),
      idempotencyKey: nieuweSleutel(),
    });
    if (data) {
      setMelding(data.melding);
      if (data.volledig) {
        setActief(null);
        setNaarLocatie("");
      } else {
        await open(actief.collo.id);
      }
      await laden();
    }
  }

  async function crossdock(kans: CrossdockKans) {
    const data = await actie({
      actie: "crossdock",
      ontvangstRegelId: kans.ontvangst_regel_id,
      idempotencyKey: nieuweSleutel(),
    });
    if (data) {
      setMelding(data.resultaat.melding);
      await laden();
    }
  }

  return (
    <div className="space-y-4">
      {melding && <Melding soort="ok">{melding}</Melding>}
      {fout && <Melding soort="bad">{fout}</Melding>}

      {/* ── Werken aan één collo ─────────────────────────────────────────── */}
      {actief ? (
        <Kaart titel={`Collo ${actief.collo.code}`}>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-slate">
                {actief.collo.soort} · {actief.collo.locatie_code || "geen locatie"} ·{" "}
                {actief.collo.status === "open" ? "wordt gevuld" : actief.collo.status}
              </span>
              <span className="text-right">
                <span className="block text-2xl font-bold tabular-nums">
                  {actief.collo.stuks}
                </span>
                <span className="block text-xs text-slate">stuks</span>
              </span>
            </div>

            {actief.collo.status === "open" ? (
              <>
                <ScanVeld
                  label="Scan wat erin gaat"
                  placeholder="Barcode of SKU — nogmaals scannen telt op"
                  waarde={scanCode}
                  onWaarde={setScanCode}
                  onScan={scanArtikel}
                  actief
                />
                <Knop onClick={sluit} disabled={bezig || actief.collo.regels === 0} className="w-full">
                  <Icon name="collo" size={18} />
                  Collo sluiten
                </Knop>
              </>
            ) : actief.collo.status === "gesloten" ? (
              <>
                <Veld
                  label="Naar welk vak?"
                  hint="Alles in dit collo wordt in één keer geboekt."
                >
                  <input
                    data-scan
                    className={invoerClasses}
                    value={naarLocatie}
                    onChange={(e) => setNaarLocatie(e.target.value)}
                    placeholder="Scan de locatie"
                  />
                </Veld>
                <Knop
                  onClick={verplaats}
                  disabled={bezig || !naarLocatie.trim()}
                  className="w-full"
                >
                  {bezig ? "Bezig…" : `${actief.collo.stuks} stuks verplaatsen`}
                </Knop>
              </>
            ) : (
              <Melding soort="info">
                Dit collo is verwerkt — de inhoud staat op zijn plek.
              </Melding>
            )}

            <ul className="divide-y divide-navy-100">
              {actief.regels.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-8 shrink-0 text-right font-bold tabular-nums">
                    {r.aantal}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.omschrijving || r.sku}</span>
                    <span className="block truncate font-mono text-xs text-slate">
                      {r.sku}
                      {r.maat ? ` · ${r.maat}` : ""}
                    </span>
                  </span>
                  {actief.collo.status === "open" && (
                    <button
                      type="button"
                      onClick={() => verwijder(r.sku)}
                      disabled={bezig}
                      className="shrink-0 text-xs text-slate underline underline-offset-2"
                    >
                      weg
                    </button>
                  )}
                </li>
              ))}
              {actief.regels.length === 0 && <LeegState tekst="Nog niets in dit collo." />}
            </ul>

            <button
              type="button"
              onClick={() => setActief(null)}
              className="text-xs text-slate underline underline-offset-2"
            >
              Sluiten
            </button>
          </div>
        </Kaart>
      ) : (
        <Kaart titel="Collo openen of aanmaken">
          <div className="space-y-4">
            <ScanVeld
              label="Scan een collolabel"
              placeholder="Bestaand collo openen"
              waarde={colloScan}
              onWaarde={setColloScan}
              onScan={zoekOpLabel}
              actief
            />

            <div>
              <span className="mb-1 block text-sm font-medium text-slate">
                Of maak een nieuwe aan
              </span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {COLLO_SOORTEN.map((s) => (
                  <button
                    key={s.waarde}
                    type="button"
                    onClick={() => setSoort(s.waarde)}
                    className={cn(
                      "min-h-tap rounded-lg border-2 px-3 text-sm font-semibold",
                      soort === s.waarde
                        ? "border-navy bg-navy text-white"
                        : "border-navy-100 bg-white text-navy"
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <Knop onClick={nieuw} disabled={bezig} className="w-full">
              <Icon name="plus" size={18} />
              Nieuw collo
            </Knop>
          </div>
        </Kaart>
      )}

      {/* ── Cross-dock ───────────────────────────────────────────────────── */}
      {kansen.length > 0 && (
        <Kaart titel={`Cross-dock kansen (${kansen.length})`}>
          <p className="mb-2 text-xs text-slate">
            Dit komt binnen en er wacht al vraag op. Direct naar de expeditie scheelt
            twee handelingen per stuk: geen inslag, geen pick.
          </p>
          <ul className="divide-y divide-navy-100">
            {kansen.map((k) => (
              <li key={k.ontvangst_regel_id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs">{k.sku}</span>
                  <span className="block truncate text-xs text-slate">
                    uit {k.ontvangst_code} · {k.gevraagd_open} gevraagd over{" "}
                    {k.opdrachten} opdracht{k.opdrachten === 1 ? "" : "en"}
                  </span>
                </span>
                <Knop variant="secundair" onClick={() => crossdock(k)} disabled={bezig}>
                  Cross-dock
                </Knop>
              </li>
            ))}
          </ul>
        </Kaart>
      )}

      {/* ── In omloop ────────────────────────────────────────────────────── */}
      <Kaart titel={`Colli in omloop (${colli.length})`}>
        {colli.length === 0 ? (
          <LeegState tekst="Geen colli open. Maak er een aan bij het uitpakken." />
        ) : (
          <ul className="divide-y divide-navy-100">
            {colli.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => open(c.id)}
                  className="flex w-full items-center gap-3 py-3 text-left"
                >
                  <span
                    className={cn(
                      "w-1.5 self-stretch rounded-full",
                      c.status === "gesloten" ? "bg-warn" : "bg-navy-100"
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{c.code}</span>
                      <span className="rounded bg-navy-50 px-2 py-0.5 text-xs">
                        {c.soort}
                      </span>
                      {c.status === "gesloten" && (
                        <span className="rounded bg-warn-100 px-2 py-0.5 text-xs text-warn">
                          wacht op verplaatsen
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-slate">
                      {c.locatie_code || "geen locatie"} · {c.stuks} stuks over {c.regels}{" "}
                      regel{c.regels === 1 ? "" : "s"}
                    </span>
                  </span>
                  <Icon name="pijl" size={18} className="shrink-0 text-slate" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Kaart>
    </div>
  );
}
