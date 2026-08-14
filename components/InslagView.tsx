"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScanVeld } from "@/components/ScanVeld";
import { Kaart, Knop, Melding, Kental, LeegState } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import { inWachtrij, nieuweSleutel, verzendWachtrij } from "@/lib/outbox";
import type { Artikel, Locatie } from "@/lib/types";
import type { BeginvoorraadVoorbeeld, IndeelVoortgang } from "@/lib/inslag";

/**
 * Inslag — voorraad het systeem in.
 *
 * De snelle inslag is bewust anders dan het gewone scanscherm: de locatie blijft
 * staan en je scant er artikel na artikel in. Wie een pallet uitpakt wil niet bij
 * elk stuk opnieuw het vak scannen. Elke scan boekt meteen; de lijst eronder
 * toont wat je net deed, met ongedaan maken als je misgrijpt.
 */

interface Geboekt {
  sleutel: string;
  sku: string;
  omschrijving: string | null;
  aantal: number;
  ongedaan: boolean;
}

export function InslagView({
  voorbeeld,
  voortgang,
  standaardAantal,
  magBeheren,
}: {
  voorbeeld: BeginvoorraadVoorbeeld;
  voortgang: IndeelVoortgang;
  standaardAantal: number;
  magBeheren: boolean;
}) {
  const router = useRouter();

  const [locatieCode, setLocatieCode] = useState("");
  const [locatie, setLocatie] = useState<Locatie | null>(null);
  const [artikelCode, setArtikelCode] = useState("");
  const [aantal, setAantal] = useState(String(standaardAantal));
  const [geboekt, setGeboekt] = useState<Geboekt[]>([]);
  const [fout, setFout] = useState("");
  const [melding, setMelding] = useState("");
  const [bezig, setBezig] = useState(false);
  const [bevestigLaden, setBevestigLaden] = useState(false);

  /* SRS kent bin-locaties per sku. Als die er zijn is dat de betere go-live:
     voorraad meteen op het juiste vak in plaats van alles op één hoop. */
  const [srs, setSrs] = useState<{
    regels: number;
    locaties: number;
    skus: number;
    stuks: number;
    geblokkeerd: number;
    generatedAt: string | null;
    verwachteRegels: number;
    volledig: boolean;
    waarschuwing: string | null;
  } | null>(null);
  const [srsFout, setSrsFout] = useState("");
  const [srsGekeken, setSrsGekeken] = useState(false);
  const [bevestigSrs, setBevestigSrs] = useState(false);

  async function kijkNaarSrs() {
    setBezig(true);
    setSrsFout("");
    try {
      const res = await fetch("/api/srs-locaties");
      const data = await res.json();
      setSrsGekeken(true);
      if (!res.ok || !data.ok) {
        setSrsFout(data.message || "Locaties opvragen mislukt.");
        return;
      }
      setSrs(data);
    } catch {
      setSrsFout("Geen verbinding met de server.");
    } finally {
      setBezig(false);
    }
  }

  async function importeerSrs() {
    setBezig(true);
    setFout("");
    setMelding("");
    try {
      const res = await fetch("/api/srs-locaties", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Importeren mislukt.");
        return;
      }
      setMelding(
        `${data.stuks.toLocaleString("nl-NL")} stuks geboekt op ${data.locaties.toLocaleString("nl-NL")} locaties uit SRS.` +
          (data.geblokkeerd > 0
            ? ` ${data.geblokkeerd} locatie(s) staan geblokkeerd en zijn niet pikbaar gemaakt.`
            : "")
      );
      setBevestigSrs(false);
      router.refresh();
    } catch {
      setFout("Geen verbinding met de server.");
    } finally {
      setBezig(false);
    }
  }

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
      setGeboekt([]);
    } catch {
      setFout("Geen verbinding met de server.");
    }
  }

  /** Elke artikelscan boekt direct. Geen bevestigknop — dat is het hele punt. */
  async function scanArtikel(code: string) {
    if (!locatie) return;
    const stuks = Number(aantal) || 1;
    setFout("");
    setBezig(true);
    try {
      const res = await fetch(`/api/artikel?code=${encodeURIComponent(code)}`);
      const data = (await res.json()) as
        | { ok: true; artikel: Artikel }
        | { ok: false; message: string };
      if (!data.ok) {
        setFout(data.message);
        setArtikelCode("");
        return;
      }

      const sleutel = nieuweSleutel();
      await inWachtrij({
        id: sleutel,
        pad: "/api/boeking",
        body: {
          sku: data.artikel.sku,
          naarLocatieId: locatie.id,
          aantal: stuks,
          reden: "ontvangst",
          idempotencyKey: sleutel,
        },
      });
      await verzendWachtrij();

      setGeboekt((g) => [
        {
          sleutel,
          sku: data.artikel.sku,
          omschrijving: data.artikel.omschrijving,
          aantal: stuks,
          ongedaan: false,
        },
        ...g,
      ]);
      setArtikelCode("");
    } catch {
      setFout("Geen verbinding — scan is niet geboekt.");
    } finally {
      setBezig(false);
    }
  }

  /** Ongedaan maken is een tegenboeking, geen verwijdering — append-only. */
  async function ongedaan(item: Geboekt) {
    if (!locatie || item.ongedaan) return;
    setBezig(true);
    try {
      const res = await fetch("/api/boeking", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sku: item.sku,
          vanLocatieId: locatie.id,
          aantal: item.aantal,
          reden: "correctie",
          notitie: "Tegenboeking van een verkeerde inslagscan",
          idempotencyKey: `undo:${item.sleutel}`,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Ongedaan maken mislukt.");
        return;
      }
      setGeboekt((g) =>
        g.map((x) => (x.sleutel === item.sleutel ? { ...x, ongedaan: true } : x))
      );
    } finally {
      setBezig(false);
    }
  }

  async function laadBeginvoorraad() {
    setBezig(true);
    setFout("");
    setMelding("");
    try {
      const res = await fetch("/api/beginvoorraad", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Laden mislukt.");
        return;
      }
      setMelding(
        `${data.stuks.toLocaleString("nl-NL")} stuks over ${data.skus.toLocaleString("nl-NL")} sku's geboekt op ${data.locatie}.`
      );
      setBevestigLaden(false);
      router.refresh();
    } catch {
      setFout("Geen verbinding met de server.");
    } finally {
      setBezig(false);
    }
  }

  const totaalIngedeeld = voortgang.ingedeeld_stuks + voortgang.wachtend_stuks;
  const percentage = totaalIngedeeld
    ? Math.round((voortgang.ingedeeld_stuks / totaalIngedeeld) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {melding && <Melding soort="ok">{melding}</Melding>}
      {fout && <Melding soort="bad">{fout}</Melding>}

      {/* ── Go-live variant 1: mét locaties uit SRS (de betere) ──────────── */}
      {!voorbeeld.alGeladen && magBeheren && (
        <Kaart titel="Locaties en voorraad uit SRS">
          <p className="text-sm text-slate">
            SRS houdt per vak bij wat er ligt. Als die gegevens er zijn, maken we de
            locaties aan en zetten we de voorraad meteen op het juiste vak — dan hoeft het
            magazijn niet te herindelen, alleen te controleren. Dit is de voorkeursroute.
          </p>

          {!srsGekeken ? (
            <Knop variant="secundair" className="mt-3 w-full" onClick={kijkNaarSrs} disabled={bezig}>
              <Icon name="zoek" size={16} />
              {bezig ? "Bezig…" : "Kijk wat SRS kent"}
            </Knop>
          ) : srsFout ? (
            <div className="mt-3 space-y-2">
              <Melding soort="warn">{srsFout}</Melding>
              <p className="text-xs text-slate">
                Gebruik zolang de route hieronder: alles op één wachtlocatie.
              </p>
            </div>
          ) : srs ? (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Kental
                  label="Locaties in SRS"
                  waarde={srs.locaties.toLocaleString("nl-NL")}
                  toelichting={`${srs.regels.toLocaleString("nl-NL")} regels`}
                />
                <Kental
                  label="Stuks op vakken"
                  waarde={srs.stuks.toLocaleString("nl-NL")}
                  toelichting={`${srs.skus.toLocaleString("nl-NL")} sku's`}
                />
              </div>
              {srs.waarschuwing && <Melding soort="bad">{srs.waarschuwing}</Melding>}
              {srs.volledig && srs.stuks < voorbeeld.stuks && (
                <Melding soort="warn">
                  SRS meldt {voorbeeld.stuks.toLocaleString("nl-NL")} stuks voorraad maar
                  heeft er maar {srs.stuks.toLocaleString("nl-NL")} op een vak staan. Het
                  verschil van {(voorbeeld.stuks - srs.stuks).toLocaleString("nl-NL")} stuks
                  ligt zonder locatie — die kun je daarna alsnog op de wachtlocatie zetten.
                </Melding>
              )}
              {!bevestigSrs ? (
                <Knop
                  className="mt-3 w-full"
                  onClick={() => setBevestigSrs(true)}
                  disabled={!srs.volledig}
                >
                  Locaties en voorraad overnemen
                </Knop>
              ) : (
                <div className="mt-3 space-y-2 rounded-lg border border-warn bg-warn-50 p-3">
                  <p className="text-sm font-medium text-warn">
                    Dit maakt {srs.locaties.toLocaleString("nl-NL")} locaties aan en boekt{" "}
                    {srs.stuks.toLocaleString("nl-NL")} stuks. Kan maar één keer.
                  </p>
                  <div className="flex gap-2">
                    <Knop onClick={importeerSrs} disabled={bezig} className="flex-1">
                      {bezig ? "Bezig…" : "Ja, overnemen"}
                    </Knop>
                    <Knop variant="secundair" onClick={() => setBevestigSrs(false)}>
                      Annuleren
                    </Knop>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </Kaart>
      )}

      {/* ── Go-live variant 2: alles op één wachtlocatie (vangnet) ───────── */}
      {!voorbeeld.alGeladen && magBeheren && voorbeeld.skus > 0 && (
        <Kaart titel="Of: alles op één wachtlocatie">
          <p className="text-sm text-slate">
            Boekt de complete SRS-magazijnvoorraad naar de wachtlocatie, zonder
            vakindeling. De totalen kloppen dan meteen — het verschil met SRS wordt nul —
            terwijl de exacte plek nog onbekend is. Daarna verhuis je scannend naar echte
            vakken. Gebruik dit als SRS geen bruikbare locatiegegevens heeft.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Kental
              label="Te laden"
              waarde={voorbeeld.stuks.toLocaleString("nl-NL")}
              toelichting={`${voorbeeld.skus.toLocaleString("nl-NL")} sku's`}
            />
            <Kental
              label="SRS-peiling"
              waarde={
                voorbeeld.gepeild_op
                  ? new Date(voorbeeld.gepeild_op).toLocaleDateString("nl-NL", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "onbekend"
              }
            />
          </div>

          {!bevestigLaden ? (
            <Knop className="mt-3 w-full" onClick={() => setBevestigLaden(true)}>
              Beginvoorraad laden
            </Knop>
          ) : (
            <div className="mt-3 space-y-2 rounded-lg border border-warn bg-warn-50 p-3">
              <p className="text-sm font-medium text-warn">
                Dit kan maar één keer. Een tweede import zou de voorraad verdubbelen en
                wordt daarom geweigerd; latere verschillen corrigeer je met tellingen.
              </p>
              <div className="flex gap-2">
                <Knop onClick={laadBeginvoorraad} disabled={bezig} className="flex-1">
                  {bezig ? "Bezig…" : "Ja, laden"}
                </Knop>
                <Knop variant="secundair" onClick={() => setBevestigLaden(false)}>
                  Annuleren
                </Knop>
              </div>
            </div>
          )}
        </Kaart>
      )}

      {/* ── Voortgang van het indelen ────────────────────────────────────── */}
      {voorbeeld.alGeladen && (
        <Kaart titel="Indelen">
          <div className="grid grid-cols-2 gap-3">
            <Kental
              label="Op echte vakken"
              waarde={voortgang.ingedeeld_stuks.toLocaleString("nl-NL")}
              toelichting={`${voortgang.ingedeeld_skus.toLocaleString("nl-NL")} sku's`}
              soort="ok"
            />
            <Kental
              label="Nog in te delen"
              waarde={voortgang.wachtend_stuks.toLocaleString("nl-NL")}
              toelichting={`${voortgang.wachtend_skus.toLocaleString("nl-NL")} sku's`}
              soort={voortgang.wachtend_stuks > 0 ? "warn" : "ok"}
            />
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-navy-50">
            <div
              className="h-full rounded-full bg-ok transition-all"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate">
            {percentage}% ingedeeld. Verhuizen doe je bij Scannen met werksoort
            &ldquo;Verplaatsen&rdquo;: van de wachtlocatie naar het echte vak.
          </p>
        </Kaart>
      )}

      {/* ── Snelle inslag ────────────────────────────────────────────────── */}
      <Kaart titel="Snelle inslag">
        <div className="space-y-4">
          <ScanVeld
            label="Locatie"
            placeholder="Scan het vak waar je inboekt"
            waarde={locatieCode}
            onWaarde={setLocatieCode}
            onScan={kiesLocatie}
            klaar={Boolean(locatie)}
            actief={!locatie}
            hint={
              locatie
                ? "Deze locatie blijft staan. Scan nu artikel na artikel."
                : undefined
            }
          />

          {locatie && (
            <>
              <div className="flex items-end gap-2">
                <label className="flex-1">
                  <span className="mb-1 block text-sm font-medium text-slate">
                    Aantal per scan
                  </span>
                  <input
                    value={aantal}
                    onChange={(e) => setAantal(e.target.value.replace(/[^0-9]/g, ""))}
                    inputMode="numeric"
                    className="geen-spinner min-h-tap w-full rounded-lg border-2 border-navy-100 bg-white px-3 text-center text-2xl font-bold tabular-nums focus:border-navy focus:outline-none"
                  />
                </label>
              </div>

              <ScanVeld
                label="Artikel"
                placeholder="Scan — boekt direct"
                waarde={artikelCode}
                onWaarde={setArtikelCode}
                onScan={scanArtikel}
                actief
              />

              <button
                type="button"
                onClick={() => {
                  setLocatie(null);
                  setLocatieCode("");
                  setGeboekt([]);
                }}
                className="text-xs text-slate underline underline-offset-2"
              >
                Andere locatie
              </button>
            </>
          )}
        </div>
      </Kaart>

      {locatie && (
        <Kaart titel={`Zojuist geboekt op ${locatie.code} (${geboekt.length})`}>
          {geboekt.length === 0 ? (
            <LeegState tekst="Nog niets gescand op deze locatie." />
          ) : (
            <ul className="divide-y divide-navy-100">
              {geboekt.map((g) => (
                <li key={g.sleutel} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-8 shrink-0 text-right font-bold tabular-nums">
                    {g.aantal}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate ${g.ongedaan ? "text-slate line-through" : ""}`}
                    >
                      {g.omschrijving || g.sku}
                    </span>
                    <span className="block font-mono text-xs text-slate">{g.sku}</span>
                  </span>
                  {g.ongedaan ? (
                    <span className="shrink-0 text-xs text-slate">teruggeboekt</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => ongedaan(g)}
                      disabled={bezig}
                      className="shrink-0 text-xs text-slate underline underline-offset-2"
                    >
                      Ongedaan
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Kaart>
      )}
    </div>
  );
}
