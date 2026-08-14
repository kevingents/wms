"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ScanVeld } from "@/components/ScanVeld";
import { Kaart, Knop, Melding, LeegState } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import { nieuweSleutel } from "@/lib/outbox";
import { cn } from "@/lib/cn";
import type { Ronde, RondeBak, RondeStop } from "@/lib/rondes";

/**
 * De pickronde lopen — batchpicken met bakken.
 *
 * Per stop staat er één ding groot op het scherm: het vak, en hoeveel je daar
 * moet pakken voor de hele kar samen. Pas daaronder de verdeling over de bakken.
 * Die volgorde is niet cosmetisch — je pakt eerst, je verdeelt daarna, en het
 * scherm hoort dat te volgen.
 *
 * Bevestigen kan in één klap ("alles verdeeld") of per bak. Dat tweede is voor
 * het geval er te weinig ligt: dan bepaalt de picker zelf welke bak voorrang
 * krijgt, want die staat bij de stelling en weet welke order haast heeft.
 */

export function RondeLopen({
  ronde: initieleRonde,
  bakken: initieleBakken,
  stops: initieleStops,
  scanLocatieVerplicht,
  scanArtikelVerplicht,
}: {
  ronde: Ronde;
  bakken: RondeBak[];
  stops: RondeStop[];
  scanLocatieVerplicht: boolean;
  scanArtikelVerplicht: boolean;
}) {
  const router = useRouter();
  const [ronde, setRonde] = useState(initieleRonde);
  const [bakken, setBakken] = useState(initieleBakken);
  const [stops, setStops] = useState(initieleStops);
  const [locatieOk, setLocatieOk] = useState(false);
  const [artikelOk, setArtikelOk] = useState(false);
  const [locatieInvoer, setLocatieInvoer] = useState("");
  const [artikelInvoer, setArtikelInvoer] = useState("");
  const [fout, setFout] = useState("");
  const [melding, setMelding] = useState("");
  const [bezig, setBezig] = useState(false);

  const open = useMemo(() => stops.filter((s) => !s.klaar), [stops]);
  const huidig = open[0] ?? null;
  const gedaan = stops.length - open.length;

  const sleutel = huidig ? `${huidig.location_id}|${huidig.sku}` : null;
  const vorige = useRef<string | null>(null);
  useEffect(() => {
    if (vorige.current === sleutel) return;
    vorige.current = sleutel;
    setLocatieOk(false);
    setArtikelOk(false);
    setLocatieInvoer("");
    setArtikelInvoer("");
    setFout("");
  }, [sleutel]);

  async function verversen() {
    const res = await fetch(`/api/rondes/${ronde.id}`);
    const data = await res.json();
    if (data.ok) {
      setRonde(data.ronde);
      setBakken(data.bakken);
      setStops(data.stops);
    }
  }

  async function starten() {
    setBezig(true);
    try {
      const res = await fetch(`/api/rondes/${ronde.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actie: "start" }),
      });
      const data = await res.json();
      if (data.ok) await verversen();
    } finally {
      setBezig(false);
    }
  }

  function controleerLocatie(code: string) {
    if (!huidig?.location_code) return;
    if (code.trim().toUpperCase() === huidig.location_code.toUpperCase()) {
      setLocatieOk(true);
      setFout("");
      setLocatieInvoer(huidig.location_code);
    } else {
      setFout(`Dat is ${code.trim().toUpperCase()}, je moet bij ${huidig.location_code} zijn.`);
      setLocatieInvoer("");
    }
  }

  function controleerArtikel(code: string) {
    if (!huidig) return;
    const schoon = code.trim().toUpperCase();
    const treffer =
      schoon === huidig.sku.toUpperCase() ||
      (huidig.barcode ? schoon === huidig.barcode.toUpperCase() : false);
    if (treffer) {
      setArtikelOk(true);
      setFout("");
      setArtikelInvoer(huidig.sku);
    } else {
      setFout("Dat is een ander artikel dan op deze regel staat.");
      setArtikelInvoer("");
    }
  }

  /** Boekt één bakregel. Meerdere achter elkaar = de hele stop. */
  async function bevestigRegel(regelId: number, aantal: number): Promise<boolean> {
    const res = await fetch("/api/picken/regel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ regelId, aantal, idempotencyKey: nieuweSleutel() }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setFout(data.message || "Bevestigen mislukt.");
      return false;
    }
    return true;
  }

  async function alleBakken() {
    if (!huidig) return;
    setBezig(true);
    setFout("");
    setMelding("");
    try {
      for (const b of huidig.bakken.filter((x) => x.status === "open")) {
        const ok = await bevestigRegel(b.regel_id, b.gevraagd);
        if (!ok) break;
      }
      await verversen();
    } catch {
      setFout("Geen verbinding — de pick is niet geboekt.");
    } finally {
      setBezig(false);
    }
  }

  async function enkeleBak(regelId: number, aantal: number, bak: number) {
    setBezig(true);
    setFout("");
    try {
      const ok = await bevestigRegel(regelId, aantal);
      if (ok && aantal === 0) setMelding(`Bak ${bak} overgeslagen — niets gevonden.`);
      await verversen();
    } finally {
      setBezig(false);
    }
  }

  const magBevestigen =
    Boolean(huidig?.location_id) &&
    (!scanLocatieVerplicht || locatieOk) &&
    (!scanArtikelVerplicht || artikelOk);

  return (
    <div className="space-y-4">
      <Kaart>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-mono text-sm font-semibold">{ronde.code}</div>
            <div className="text-sm text-slate">
              {ronde.bakken} bakken · {ronde.stuks} stuks
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums">
              {gedaan}/{stops.length}
            </div>
            <div className="text-xs text-slate">stops gedaan</div>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-navy-50">
          <div
            className="h-full rounded-full bg-navy transition-all"
            style={{ width: `${stops.length ? (gedaan / stops.length) * 100 : 0}%` }}
          />
        </div>
      </Kaart>

      {melding && <Melding soort="warn">{melding}</Melding>}
      {fout && <Melding soort="bad">{fout}</Melding>}

      {ronde.status === "open" && (
        <Kaart>
          <p className="mb-3 text-sm text-slate">
            Zet {ronde.bakken} bakken op je kar, genummerd 1 tot {ronde.bakken}. Bij
            starten wordt de ronde aan jou toegewezen.
          </p>
          <Knop onClick={starten} disabled={bezig} className="w-full">
            {bezig ? "Bezig…" : "Ronde starten"}
          </Knop>
        </Kaart>
      )}

      {ronde.status !== "open" && huidig && (
        <Kaart>
          {!huidig.location_id ? (
            <div className="space-y-3">
              <Melding soort="bad">
                Voor dit artikel is geen voorraad toegewezen. Meld het bij je teamleider.
              </Melding>
              <div className="font-semibold">{huidig.omschrijving || huidig.sku}</div>
              <div className="space-y-1">
                {huidig.bakken.map((b) => (
                  <Knop
                    key={b.regel_id}
                    variant="secundair"
                    className="w-full"
                    disabled={bezig || b.status !== "open"}
                    onClick={() => enkeleBak(b.regel_id, 0, b.bak)}
                  >
                    Bak {b.bak} overslaan ({b.gevraagd} stuks)
                  </Knop>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-stretch gap-3">
                <div className="flex-1 rounded-lg bg-navy p-4 text-white">
                  <div className="text-xs uppercase tracking-widest text-white/60">
                    Loop naar
                  </div>
                  <div className="font-mono text-3xl font-bold sm:text-4xl">
                    {huidig.location_code}
                  </div>
                  {huidig.zone && (
                    <div className="mt-0.5 text-sm text-white/70">zone {huidig.zone}</div>
                  )}
                </div>
                <div className="flex w-28 flex-col items-center justify-center rounded-lg border-2 border-navy bg-white">
                  <div className="text-4xl font-bold tabular-nums text-navy">
                    {huidig.totaal}
                  </div>
                  <div className="text-xs text-slate">pakken</div>
                </div>
              </div>

              <div>
                <div className="font-semibold">{huidig.omschrijving || huidig.sku}</div>
                <div className="text-sm text-slate">
                  {[huidig.merk, huidig.kleur, huidig.maat].filter(Boolean).join(" · ")}
                </div>
                <div className="font-mono text-xs text-slate">{huidig.sku}</div>
              </div>

              {scanLocatieVerplicht && (
                <ScanVeld
                  label="Scan de locatie"
                  placeholder={huidig.location_code ?? ""}
                  waarde={locatieInvoer}
                  onWaarde={setLocatieInvoer}
                  onScan={controleerLocatie}
                  klaar={locatieOk}
                  actief={!locatieOk}
                />
              )}

              {scanArtikelVerplicht && (
                <ScanVeld
                  label="Scan het artikel"
                  placeholder={huidig.barcode ?? huidig.sku}
                  waarde={artikelInvoer}
                  onWaarde={setArtikelInvoer}
                  onScan={controleerArtikel}
                  klaar={artikelOk}
                  actief={(!scanLocatieVerplicht || locatieOk) && !artikelOk}
                  hint={
                    huidig.barcode
                      ? undefined
                      : "Dit artikel heeft geen barcode — typ de SKU over."
                  }
                />
              )}

              {/* ── Verdeling over de bakken ─────────────────────────────── */}
              <div>
                <div className="mb-2 text-sm font-medium text-slate">
                  Verdeel over de bakken
                </div>
                <ul className="space-y-1.5">
                  {huidig.bakken.map((b) => (
                    <li
                      key={b.regel_id}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border px-3 py-2",
                        b.status === "open"
                          ? "border-navy-100 bg-white"
                          : "border-ok bg-ok-50"
                      )}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-navy text-lg font-bold text-white">
                        {b.bak}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-lg font-bold tabular-nums">
                          {b.gevraagd} stuks
                        </span>
                        <span className="block truncate text-xs text-slate">
                          {b.opdracht_code} · {b.bestemming || "geen bestemming"}
                        </span>
                      </span>
                      {b.status === "open" ? (
                        <button
                          type="button"
                          disabled={!magBevestigen || bezig}
                          onClick={() => enkeleBak(b.regel_id, 0, b.bak)}
                          className="shrink-0 text-xs text-slate underline underline-offset-2 disabled:opacity-40"
                        >
                          niets
                        </button>
                      ) : (
                        <Icon
                          name={b.gepikt === b.gevraagd ? "vink" : "alert"}
                          size={18}
                          className={b.gepikt === b.gevraagd ? "text-ok" : "text-warn"}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              <Knop
                onClick={alleBakken}
                disabled={!magBevestigen || bezig}
                className="w-full"
              >
                <Icon name="vink" size={18} />
                {bezig ? "Bezig…" : `${huidig.totaal} gepakt en verdeeld`}
              </Knop>
            </div>
          )}
        </Kaart>
      )}

      {ronde.status !== "open" && !huidig && (
        <Kaart>
          <Melding soort="ok">
            <span className="flex items-center gap-2">
              <Icon name="vink" size={16} />
              Ronde compleet — alle stops gedaan.
            </span>
          </Melding>
          <p className="mt-3 text-sm text-slate">
            Elke bak bevat nu één order. Sluit ze af bij Picken; verzenden gaat per
            opdracht, want elke bak heeft een eigen bestemming.
          </p>
        </Kaart>
      )}

      <Kaart titel={`Bakken (${bakken.length})`}>
        {bakken.length === 0 ? (
          <LeegState tekst="Geen bakken in deze ronde." />
        ) : (
          <ul className="divide-y divide-navy-100">
            {bakken.map((b) => (
              <li key={b.bak} className="flex items-center gap-3 py-2 text-sm">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-navy-50 font-bold">
                  {b.bak}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {b.bestemming || "geen bestemming"}
                  </span>
                  <span className="block font-mono text-xs text-slate">
                    {b.opdracht_code}
                  </span>
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <span
                    className={cn(
                      "font-semibold",
                      b.gepikt === b.gevraagd ? "text-ok" : "text-slate"
                    )}
                  >
                    {b.gepikt}/{b.gevraagd}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Kaart>
    </div>
  );
}
