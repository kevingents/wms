"use client";

import { useCallback, useEffect, useState } from "react";
import { ScanVeld } from "@/components/ScanVeld";
import { Icon } from "@/components/ui/Icon";
import { Kaart, Knop, Melding, LeegState } from "@/components/ui/Basis";
import { inWachtrij, nieuweSleutel, verzendWachtrij } from "@/lib/outbox";
import { cn } from "@/lib/cn";
import type { Artikel, BoekingReden, Locatie, SaldoRegel } from "@/lib/types";

/**
 * Het scanscherm — waar het werk gebeurt.
 *
 * Vier werksoorten, elk met een vaste volgorde van velden. De volgorde is niet
 * cosmetisch: eerst het artikel, dan de locatie(s), dan pas het aantal. Zo staat
 * op het moment dat iemand een aantal intikt altijd op het scherm wát hij boekt
 * en wáár — dat scheelt de meeste fouten.
 *
 * Boeken gaat altijd via de outbox: eerst lokaal opslaan met een eigen
 * idempotency-sleutel, dan versturen. Valt de wifi weg, dan gaat het werk door.
 */

type Werksoort = "ontvangst" | "verplaatsing" | "uitslag" | "afschrijving";

const WERKSOORTEN: {
  waarde: Werksoort;
  label: string;
  uitleg: string;
  reden: BoekingReden;
  van: boolean;
  naar: boolean;
}[] = [
  {
    waarde: "ontvangst",
    label: "Ontvangst",
    uitleg: "Nieuwe goederen het magazijn in",
    reden: "ontvangst",
    van: false,
    naar: true,
  },
  {
    waarde: "verplaatsing",
    label: "Verplaatsen",
    uitleg: "Van de ene locatie naar de andere",
    reden: "verplaatsing",
    van: true,
    naar: true,
  },
  {
    waarde: "uitslag",
    label: "Uitslag",
    uitleg: "Naar een winkel of klant",
    reden: "verzonden",
    van: true,
    naar: false,
  },
  {
    waarde: "afschrijving",
    label: "Afschrijven",
    uitleg: "Beschadigd of zoek",
    reden: "afschrijving",
    van: true,
    naar: false,
  },
];

interface Gevonden {
  artikel: Artikel;
  saldi: SaldoRegel[];
  totaal: number;
}

export function ScanView({ bevestigBoven }: { bevestigBoven: number }) {
  const [werksoort, setWerksoort] = useState<Werksoort>("verplaatsing");
  const soort = WERKSOORTEN.find((w) => w.waarde === werksoort)!;

  const [artikelCode, setArtikelCode] = useState("");
  const [gevonden, setGevonden] = useState<Gevonden | null>(null);
  const [vanCode, setVanCode] = useState("");
  const [van, setVan] = useState<Locatie | null>(null);
  const [naarCode, setNaarCode] = useState("");
  const [naar, setNaar] = useState<Locatie | null>(null);
  const [aantal, setAantal] = useState("");
  const [fout, setFout] = useState("");
  const [gelukt, setGelukt] = useState("");
  const [bezig, setBezig] = useState(false);

  const legen = useCallback(() => {
    setArtikelCode("");
    setGevonden(null);
    setVanCode("");
    setVan(null);
    setNaarCode("");
    setNaar(null);
    setAantal("");
    setFout("");
  }, []);

  /* Wisselen van werksoort maakt het scherm leeg — half ingevulde velden uit een
     andere flow zijn een bron van misboekingen. */
  useEffect(() => {
    legen();
    setGelukt("");
  }, [werksoort, legen]);

  async function zoekArtikel(code: string) {
    setFout("");
    try {
      const res = await fetch(`/api/artikel?code=${encodeURIComponent(code)}`);
      const data = (await res.json()) as
        | { ok: true; artikel: Artikel; saldi: SaldoRegel[]; totaal: number }
        | { ok: false; message: string };
      if (!data.ok) {
        setFout(data.message);
        setArtikelCode("");
        return;
      }
      setGevonden({ artikel: data.artikel, saldi: data.saldi, totaal: data.totaal });
      setArtikelCode(data.artikel.sku);
    } catch {
      setFout("Geen verbinding — artikel kan niet opgezocht worden. Probeer opnieuw.");
    }
  }

  async function zoekLocatie(code: string, doel: "van" | "naar") {
    setFout("");
    try {
      const res = await fetch(`/api/locaties?code=${encodeURIComponent(code)}`);
      const data = (await res.json()) as
        | { ok: true; locatie: Locatie }
        | { ok: false; message: string };
      if (!data.ok) {
        setFout(data.message);
        if (doel === "van") setVanCode("");
        else setNaarCode("");
        return;
      }
      if (doel === "van") {
        setVan(data.locatie);
        setVanCode(data.locatie.code);
      } else {
        setNaar(data.locatie);
        setNaarCode(data.locatie.code);
      }
    } catch {
      setFout("Geen verbinding — locatie kan niet opgezocht worden.");
    }
  }

  const aantalGetal = Number(aantal);
  const opVanLocatie = van
    ? (gevonden?.saldi.find((s) => s.location_id === van.id)?.qty ?? 0)
    : null;

  const compleet =
    Boolean(gevonden) &&
    (!soort.van || Boolean(van)) &&
    (!soort.naar || Boolean(naar)) &&
    Number.isInteger(aantalGetal) &&
    aantalGetal > 0;

  async function boeken() {
    if (!compleet || !gevonden) return;

    if (aantalGetal > bevestigBoven) {
      const akkoord = window.confirm(
        `${aantalGetal} stuks van ${gevonden.artikel.sku} boeken. Klopt dat aantal?`
      );
      if (!akkoord) return;
    }

    /* Vooraf waarschuwen als er te weinig ligt. De server weigert dit sowieso,
       maar dan is de medewerker al doorgelopen naar de volgende locatie. */
    if (soort.van && opVanLocatie !== null && aantalGetal > opVanLocatie) {
      setFout(
        `Op ${van?.code} ligt volgens het systeem ${opVanLocatie} stuks. Tel de locatie en corrigeer bij Tellen.`
      );
      return;
    }

    setBezig(true);
    setFout("");
    try {
      await inWachtrij({
        id: nieuweSleutel(),
        pad: "/api/boeking",
        body: {
          sku: gevonden.artikel.sku,
          vanLocatieId: soort.van ? van?.id : null,
          naarLocatieId: soort.naar ? naar?.id : null,
          aantal: aantalGetal,
          reden: soort.reden,
          idempotencyKey: nieuweSleutel(),
        },
      });
      await verzendWachtrij();
      setGelukt(
        `${aantalGetal}× ${gevonden.artikel.sku} — ${soort.label.toLowerCase()}` +
          (van ? ` van ${van.code}` : "") +
          (naar ? ` naar ${naar.code}` : "")
      );
      legen();
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {WERKSOORTEN.map((w) => (
          <button
            key={w.waarde}
            type="button"
            onClick={() => setWerksoort(w.waarde)}
            className={cn(
              "min-h-tap rounded-lg border-2 px-3 py-2 text-left",
              werksoort === w.waarde
                ? "border-navy bg-navy text-white"
                : "border-navy-100 bg-white text-navy hover:border-navy-600"
            )}
          >
            <div className="text-sm font-semibold">{w.label}</div>
            <div
              className={cn(
                "text-[11px] leading-tight",
                werksoort === w.waarde ? "text-white/70" : "text-slate"
              )}
            >
              {w.uitleg}
            </div>
          </button>
        ))}
      </div>

      {gelukt && (
        <Melding soort="ok">
          <span className="flex items-center gap-2">
            <Icon name="vink" size={16} />
            Geboekt: {gelukt}
          </span>
        </Melding>
      )}
      {fout && <Melding soort="bad">{fout}</Melding>}

      <Kaart>
        <div className="space-y-4">
          <ScanVeld
            label="1. Artikel"
            placeholder="Scan barcode of typ SKU"
            waarde={artikelCode}
            onWaarde={setArtikelCode}
            onScan={zoekArtikel}
            klaar={Boolean(gevonden)}
            actief={!gevonden}
          />

          {gevonden && (
            <div className="rounded-lg bg-navy-50 p-3">
              <div className="font-semibold text-navy">
                {gevonden.artikel.omschrijving || gevonden.artikel.sku}
              </div>
              <div className="mt-0.5 text-sm text-slate">
                {[gevonden.artikel.merk, gevonden.artikel.kleur, gevonden.artikel.maat]
                  .filter(Boolean)
                  .join(" · ") || "geen kenmerken bekend"}
              </div>
              <div className="mt-2 text-sm">
                <span className="font-semibold">{gevonden.totaal}</span> stuks in het
                magazijn
                {gevonden.saldi.length > 0 && (
                  <span className="text-slate">
                    {" "}
                    op {gevonden.saldi.length} locatie
                    {gevonden.saldi.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              {gevonden.saldi.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {gevonden.saldi.map((s) => (
                    <li
                      key={s.location_id}
                      className="rounded bg-white px-2 py-1 font-mono text-xs"
                    >
                      {s.location_code} · {s.qty}
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={legen}
                className="mt-2 text-xs text-slate underline underline-offset-2"
              >
                Ander artikel
              </button>
            </div>
          )}

          {soort.van && (
            <ScanVeld
              label={`2. Van locatie`}
              placeholder="Scan locatiecode"
              waarde={vanCode}
              onWaarde={setVanCode}
              onScan={(v) => zoekLocatie(v, "van")}
              klaar={Boolean(van)}
              actief={Boolean(gevonden) && !van}
              hint={
                van && opVanLocatie !== null
                  ? `Hier ligt volgens het systeem ${opVanLocatie} stuks.`
                  : undefined
              }
            />
          )}

          {soort.naar && (
            <ScanVeld
              label={`${soort.van ? "3" : "2"}. Naar locatie`}
              placeholder="Scan locatiecode"
              waarde={naarCode}
              onWaarde={setNaarCode}
              onScan={(v) => zoekLocatie(v, "naar")}
              klaar={Boolean(naar)}
              actief={Boolean(gevonden) && (!soort.van || Boolean(van)) && !naar}
            />
          )}

          <div>
            <span className="mb-1 block text-sm font-medium text-slate">
              {[soort.van, soort.naar].filter(Boolean).length + 2}. Aantal
            </span>
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                aria-label="Eén minder"
                onClick={() => setAantal(String(Math.max(1, (Number(aantal) || 1) - 1)))}
                className="min-h-tap w-14 rounded-lg border border-navy-100 bg-white text-navy"
              >
                <Icon name="min" size={20} className="mx-auto" />
              </button>
              <input
                value={aantal}
                onChange={(e) => setAantal(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                placeholder="0"
                className="geen-spinner min-h-tap flex-1 rounded-lg border-2 border-navy-100 bg-white px-3 text-center text-2xl font-bold tabular-nums focus:border-navy focus:outline-none"
              />
              <button
                type="button"
                aria-label="Eén meer"
                onClick={() => setAantal(String((Number(aantal) || 0) + 1))}
                className="min-h-tap w-14 rounded-lg border border-navy-100 bg-white text-navy"
              >
                <Icon name="plus" size={20} className="mx-auto" />
              </button>
            </div>
          </div>

          <Knop onClick={boeken} disabled={!compleet || bezig} className="w-full">
            {bezig ? "Bezig…" : `${soort.label} boeken`}
          </Knop>
        </div>
      </Kaart>

      {!gevonden && !gelukt && (
        <LeegState tekst="Scan een artikel om te beginnen. Het veld staat al scherp." />
      )}
    </div>
  );
}
