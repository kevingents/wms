"use client";

import { useState } from "react";
import { Kaart, Knop, Melding, LeegState, invoerClasses } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import type { Artikel, SaldoRegel } from "@/lib/types";

/**
 * Voorraad opzoeken. Twee ingangen, want in het magazijn stel je twee vragen:
 * "waar ligt dit?" (scan een artikel) en "wat ligt hier?" (scan een locatie).
 */
export function VoorraadZoeker() {
  const [modus, setModus] = useState<"artikel" | "locatie">("artikel");
  const [term, setTerm] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState("");
  const [artikel, setArtikel] = useState<Artikel | null>(null);
  const [saldi, setSaldi] = useState<SaldoRegel[]>([]);
  const [totaal, setTotaal] = useState(0);
  const [locatieCode, setLocatieCode] = useState("");
  const [lijst, setLijst] = useState<Artikel[] | null>(null);

  function leeg() {
    setArtikel(null);
    setSaldi([]);
    setTotaal(0);
    setLocatieCode("");
    setLijst(null);
    setFout("");
  }

  async function zoeken(e: React.FormEvent) {
    e.preventDefault();
    const q = term.trim();
    if (!q) return;
    leeg();
    setBezig(true);
    try {
      if (modus === "locatie") {
        const res = await fetch(`/api/locaties?code=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (!data.ok) {
          setFout(data.message);
          return;
        }
        setLocatieCode(data.locatie.code);
        setSaldi(data.inhoud);
        setTotaal(
          (data.inhoud as SaldoRegel[]).reduce((s: number, r: SaldoRegel) => s + r.qty, 0)
        );
        return;
      }

      const res = await fetch(`/api/artikel?code=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.ok) {
        setArtikel(data.artikel);
        setSaldi(data.saldi);
        setTotaal(data.totaal);
        return;
      }

      /* Geen exacte treffer: val terug op vrij zoeken, dan kan de medewerker
         alsnog kiezen zonder de code precies te kennen. */
      const zoek = await fetch(`/api/artikel?zoek=${encodeURIComponent(q)}`);
      const zoekData = await zoek.json();
      if (zoekData.ok && zoekData.artikelen.length > 0) {
        setLijst(zoekData.artikelen);
        return;
      }
      setFout(data.message || "Niets gevonden.");
    } catch {
      setFout("Geen verbinding met de server.");
    } finally {
      setBezig(false);
    }
  }

  async function kiesArtikel(sku: string) {
    setTerm(sku);
    setLijst(null);
    setBezig(true);
    try {
      const res = await fetch(`/api/artikel?code=${encodeURIComponent(sku)}`);
      const data = await res.json();
      if (data.ok) {
        setArtikel(data.artikel);
        setSaldi(data.saldi);
        setTotaal(data.totaal);
      }
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["artikel", "locatie"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setModus(m);
              leeg();
            }}
            className={`min-h-tap flex-1 rounded-lg border-2 px-3 text-sm font-semibold ${
              modus === m
                ? "border-navy bg-navy text-white"
                : "border-navy-100 bg-white text-navy"
            }`}
          >
            {m === "artikel" ? "Waar ligt dit artikel?" : "Wat ligt op deze locatie?"}
          </button>
        ))}
      </div>

      <form onSubmit={zoeken} className="flex gap-2">
        <input
          data-scan={modus === "locatie" ? "" : undefined}
          className={invoerClasses}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={
            modus === "artikel" ? "Barcode, SKU of omschrijving" : "Locatiecode, bv. A-01-3"
          }
          autoComplete="off"
          autoFocus
        />
        <Knop type="submit" disabled={bezig}>
          <Icon name="zoek" size={18} />
          <span className="sr-only sm:not-sr-only">Zoek</span>
        </Knop>
      </form>

      {fout && <Melding soort="bad">{fout}</Melding>}

      {lijst && (
        <Kaart titel={`${lijst.length} treffers`}>
          <ul className="divide-y divide-navy-100">
            {lijst.map((a) => (
              <li key={a.sku}>
                <button
                  type="button"
                  onClick={() => kiesArtikel(a.sku)}
                  className="flex w-full items-center gap-3 py-2 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {a.omschrijving || a.sku}
                    </span>
                    <span className="block truncate font-mono text-xs text-slate">
                      {a.sku}
                      {a.maat ? ` · ${a.maat}` : ""}
                      {a.kleur ? ` · ${a.kleur}` : ""}
                    </span>
                  </span>
                  <Icon name="pijl" size={16} className="text-slate" />
                </button>
              </li>
            ))}
          </ul>
        </Kaart>
      )}

      {(artikel || locatieCode) && (
        <Kaart
          titel={artikel ? artikel.omschrijving || artikel.sku : `Locatie ${locatieCode}`}
        >
          <div className="mb-3 text-sm">
            <span className="text-2xl font-bold tabular-nums">{totaal}</span>{" "}
            <span className="text-slate">
              stuks {artikel ? `over ${saldi.length} locatie${saldi.length === 1 ? "" : "s"}` : "op deze locatie"}
            </span>
          </div>

          {saldi.length === 0 ? (
            <LeegState
              tekst={
                artikel
                  ? "Dit artikel ligt nergens in het magazijn volgens het WMS."
                  : "Deze locatie is leeg."
              }
            />
          ) : (
            <ul className="divide-y divide-navy-100">
              {saldi.map((s) => (
                <li
                  key={`${s.sku}-${s.location_id}`}
                  className="flex items-center gap-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono font-medium">
                      {artikel ? s.location_code : s.sku}
                    </span>
                    <span className="block truncate text-xs text-slate">
                      {artikel
                        ? s.zone
                          ? `zone ${s.zone}`
                          : "geen zone"
                        : s.omschrijving || "onbekend artikel"}
                    </span>
                  </span>
                  <span className="text-lg font-bold tabular-nums">{s.qty}</span>
                </li>
              ))}
            </ul>
          )}
        </Kaart>
      )}
    </div>
  );
}
