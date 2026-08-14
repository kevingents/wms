"use client";

import { useState } from "react";
import { ScanVeld } from "@/components/ScanVeld";
import { Kaart, Knop, Melding, LeegState } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import { nieuweSleutel } from "@/lib/outbox";
import type { Artikel, Locatie, SaldoRegel } from "@/lib/types";

/**
 * Tellen. Je scant een locatie, dan per artikel wat je telt. Het systeem boekt
 * het verschil als telling-mutatie — het gételde aantal wordt de nieuwe waarheid.
 *
 * Bij blind tellen zie je het verwachte aantal pas ná invoer. Dat levert
 * betrouwbaardere tellingen op: wie het verwachte getal ziet staan, telt
 * onbewust naar dat getal toe.
 *
 * Tellingen gaan bewust NIET via de offline-outbox: het verschil wordt op de
 * server berekend tegen het saldo op dát moment. Een telling die een uur later
 * alsnog wordt verstuurd zou het verkeerde verschil boeken.
 */

interface Geteld {
  sku: string;
  omschrijving: string | null;
  geteld: number;
  verwacht: number;
  verschil: number;
  controle: boolean;
}

export function TelView({ blind }: { blind: boolean }) {
  const [locatieCode, setLocatieCode] = useState("");
  const [locatie, setLocatie] = useState<Locatie | null>(null);
  const [inhoud, setInhoud] = useState<SaldoRegel[]>([]);
  const [artikelCode, setArtikelCode] = useState("");
  const [artikel, setArtikel] = useState<Artikel | null>(null);
  const [aantal, setAantal] = useState("");
  const [geteld, setGeteld] = useState<Geteld[]>([]);
  const [fout, setFout] = useState("");
  const [bezig, setBezig] = useState(false);

  async function kiesLocatie(code: string) {
    setFout("");
    try {
      const res = await fetch(`/api/locaties?code=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!data.ok) {
        setFout(data.message);
        setLocatieCode("");
        return;
      }
      setLocatie(data.locatie);
      setLocatieCode(data.locatie.code);
      setInhoud(data.inhoud);
      setGeteld([]);
    } catch {
      setFout("Geen verbinding met de server.");
    }
  }

  async function kiesArtikel(code: string) {
    setFout("");
    try {
      const res = await fetch(`/api/artikel?code=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!data.ok) {
        setFout(data.message);
        setArtikelCode("");
        return;
      }
      setArtikel(data.artikel);
      setArtikelCode(data.artikel.sku);
    } catch {
      setFout("Geen verbinding met de server.");
    }
  }

  async function tellingBoeken() {
    if (!locatie || !artikel || aantal === "") return;
    setBezig(true);
    setFout("");
    try {
      const res = await fetch("/api/telling", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sku: artikel.sku,
          locatieId: locatie.id,
          geteld: Number(aantal),
          idempotencyKey: nieuweSleutel(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Telling niet verwerkt.");
        return;
      }
      setGeteld((g) => [
        {
          sku: artikel.sku,
          omschrijving: artikel.omschrijving,
          geteld: Number(aantal),
          verwacht: data.verwacht,
          verschil: data.verschil,
          controle: Boolean(data.controle),
        },
        ...g.filter((x) => x.sku !== artikel.sku),
      ]);
      setArtikel(null);
      setArtikelCode("");
      setAantal("");
    } catch {
      setFout("Geen verbinding — telling is niet opgeslagen. Probeer opnieuw.");
    } finally {
      setBezig(false);
    }
  }

  const nogNietGeteld = inhoud.filter((i) => !geteld.some((g) => g.sku === i.sku));

  return (
    <div className="space-y-4">
      {fout && <Melding soort="bad">{fout}</Melding>}

      <Kaart>
        <div className="space-y-4">
          <ScanVeld
            label="Locatie"
            placeholder="Scan de locatie die je telt"
            waarde={locatieCode}
            onWaarde={setLocatieCode}
            onScan={kiesLocatie}
            klaar={Boolean(locatie)}
            actief={!locatie}
            hint={
              locatie
                ? blind
                  ? `${inhoud.length} artikelen verwacht — aantallen verborgen (blind tellen).`
                  : `${inhoud.length} artikelen verwacht op deze locatie.`
                : undefined
            }
          />

          {locatie && (
            <>
              <ScanVeld
                label="Artikel"
                placeholder="Scan het artikel dat je telt"
                waarde={artikelCode}
                onWaarde={setArtikelCode}
                onScan={kiesArtikel}
                klaar={Boolean(artikel)}
                actief={!artikel}
              />

              {artikel && (
                <>
                  <div className="rounded-lg bg-navy-50 p-3 text-sm">
                    <div className="font-semibold">
                      {artikel.omschrijving || artikel.sku}
                    </div>
                    <div className="text-slate">
                      {[artikel.merk, artikel.kleur, artikel.maat]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>

                  <div>
                    <span className="mb-1 block text-sm font-medium text-slate">
                      Aantal geteld
                    </span>
                    <input
                      value={aantal}
                      onChange={(e) => setAantal(e.target.value.replace(/[^0-9]/g, ""))}
                      inputMode="numeric"
                      placeholder="0"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void tellingBoeken();
                        }
                      }}
                      className="geen-spinner min-h-tap w-full rounded-lg border-2 border-navy-100 bg-white px-3 text-center text-3xl font-bold tabular-nums focus:border-navy focus:outline-none"
                    />
                  </div>

                  <Knop
                    onClick={tellingBoeken}
                    disabled={bezig || aantal === ""}
                    className="w-full"
                  >
                    {bezig ? "Bezig…" : "Telling vastleggen"}
                  </Knop>
                </>
              )}

              <button
                type="button"
                onClick={() => {
                  setLocatie(null);
                  setLocatieCode("");
                  setArtikel(null);
                  setArtikelCode("");
                  setAantal("");
                  setGeteld([]);
                }}
                className="text-xs text-slate underline underline-offset-2"
              >
                Andere locatie tellen
              </button>
            </>
          )}
        </div>
      </Kaart>

      {geteld.length > 0 && (
        <Kaart titel={`Geteld op ${locatie?.code} (${geteld.length})`}>
          <ul className="divide-y divide-navy-100">
            {geteld.map((g) => (
              <li key={g.sku} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {g.omschrijving || g.sku}
                  </span>
                  <span className="block font-mono text-xs text-slate">{g.sku}</span>
                </span>
                <span className="text-right">
                  <span className="block font-bold tabular-nums">{g.geteld}</span>
                  <span className="block text-xs text-slate">was {g.verwacht}</span>
                </span>
                <span
                  className={`w-12 text-right font-semibold tabular-nums ${
                    g.verschil === 0 ? "text-ok" : g.controle ? "text-bad" : "text-warn"
                  }`}
                >
                  {g.verschil > 0 ? `+${g.verschil}` : g.verschil}
                </span>
                {g.controle && (
                  <Icon name="alert" size={16} className="text-bad" aria-label="controle nodig" />
                )}
              </li>
            ))}
          </ul>
        </Kaart>
      )}

      {locatie && nogNietGeteld.length > 0 && (
        <Kaart titel={`Nog niet geteld (${nogNietGeteld.length})`}>
          <p className="mb-2 text-xs text-slate">
            Deze artikelen liggen hier volgens het systeem maar zijn nog niet geteld. Tel
            je ze niet, dan blijft hun saldo ongewijzigd.
          </p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {nogNietGeteld.map((i) => (
              <li key={i.sku} className="truncate text-sm">
                <span className="font-mono text-xs text-slate">{i.sku}</span>{" "}
                {i.omschrijving}
                {!blind && <span className="text-slate"> · {i.qty}</span>}
              </li>
            ))}
          </ul>
        </Kaart>
      )}

      {!locatie && <LeegState tekst="Scan een locatie om te beginnen met tellen." />}
    </div>
  );
}
