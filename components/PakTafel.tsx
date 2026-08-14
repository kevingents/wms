"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScanVeld } from "@/components/ScanVeld";
import { Kaart, Knop, Melding, Veld, LeegState, invoerClasses } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { DoosType, Zending, ZendingRegel } from "@/lib/inpakken";

/**
 * De paktafel.
 *
 * Scan elk artikel dat de doos in gaat. Dat is de laatste kans om een mispick te
 * vangen vóór hij bij de klant ligt, en het kost twee seconden per stuk. Scan je
 * iets dat er niet bij hoort, dan zegt het scherm dat meteen — dán ligt het nog
 * op tafel in plaats van in een doos onderweg naar Groningen.
 */
export function PakTafel({
  zending: initieel,
  regels: initieleRegels,
  doosTypes,
  standaardVervoerder,
  magForceren,
}: {
  zending: Zending;
  regels: ZendingRegel[];
  doosTypes: DoosType[];
  standaardVervoerder: string;
  magForceren: boolean;
}) {
  const router = useRouter();
  const [zending, setZending] = useState(initieel);
  const [regels, setRegels] = useState(initieleRegels);
  const [scanCode, setScanCode] = useState("");
  const [doosType, setDoosType] = useState(doosTypes[0]?.code ?? "");
  const [gewicht, setGewicht] = useState("");
  const [vervoerder, setVervoerder] = useState(standaardVervoerder);
  const [tracking, setTracking] = useState("");
  const [fout, setFout] = useState("");
  const [melding, setMelding] = useState("");
  const [bezig, setBezig] = useState(false);

  const open = regels.filter((r) => !r.gecontroleerd);
  const alsGecontroleerd = open.length === 0;

  async function verversen() {
    const res = await fetch(`/api/zendingen?id=${zending.id}`);
    const data = await res.json();
    if (data.ok) {
      setZending(data.zending);
      setRegels(data.regels);
    }
  }

  async function actie(body: Record<string, unknown>) {
    setBezig(true);
    setFout("");
    try {
      const res = await fetch("/api/zendingen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, id: zending.id }),
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

  async function scan(code: string) {
    setMelding("");
    const data = await actie({ actie: "controleer", code });
    setScanCode("");
    if (data) {
      await verversen();
      setMelding("");
    }
  }

  async function inpakken() {
    const data = await actie({
      actie: "inpakken",
      doosType,
      gewichtGram: gewicht ? Number(gewicht) : null,
      vervoerder,
    });
    if (data) {
      setZending(data.zending);
      setMelding("Doos dicht. Plak het label erop en verzend.");
      router.refresh();
    }
  }

  async function forceerInpakken() {
    const akkoord = window.confirm(
      `${open.length} artikel(en) zijn niet gescand. Toch inpakken?`
    );
    if (!akkoord) return;
    const data = await actie({
      actie: "inpakken",
      doosType,
      gewichtGram: gewicht ? Number(gewicht) : null,
      vervoerder,
      forceer: true,
    });
    if (data) {
      setZending(data.zending);
      router.refresh();
    }
  }

  async function verzenden() {
    const data = await actie({ actie: "verzenden", tracking: tracking || null });
    if (data) {
      router.push("/inpakken");
      router.refresh();
    }
  }

  const gekozenDoos = doosTypes.find((d) => d.code === doosType);

  return (
    <div className="space-y-4">
      <Kaart>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-mono text-sm font-semibold">{zending.code}</div>
            <div className="text-sm text-slate">
              {zending.bestemming || "geen bestemming"}
              {zending.opdracht_code ? ` · uit ${zending.opdracht_code}` : ""}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums">
              {regels.length - open.length}/{regels.length}
            </div>
            <div className="text-xs text-slate">gescand</div>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-navy-50">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              alsGecontroleerd ? "bg-ok" : "bg-navy"
            )}
            style={{
              width: `${regels.length ? ((regels.length - open.length) / regels.length) * 100 : 0}%`,
            }}
          />
        </div>
      </Kaart>

      {melding && <Melding soort="ok">{melding}</Melding>}
      {fout && <Melding soort="bad">{fout}</Melding>}

      {zending.status === "open" && (
        <Kaart>
          <div className="space-y-4">
            <ScanVeld
              label="Scan wat je in de doos legt"
              placeholder="Barcode of SKU"
              waarde={scanCode}
              onWaarde={setScanCode}
              onScan={scan}
              actief={!alsGecontroleerd}
              klaar={alsGecontroleerd}
              hint={
                alsGecontroleerd
                  ? "Alles gecontroleerd. Kies een doos en sluit af."
                  : `Nog ${open.length} te gaan.`
              }
            />

            <div className="grid gap-3 sm:grid-cols-3">
              <Veld label="Doos" className="sm:col-span-1">
                <select
                  className={invoerClasses}
                  value={doosType}
                  onChange={(e) => setDoosType(e.target.value)}
                >
                  {doosTypes.map((d) => (
                    <option key={d.code} value={d.code}>
                      {d.code} — {d.naam}
                    </option>
                  ))}
                </select>
              </Veld>
              <Veld
                label="Gewicht (gram)"
                hint={gekozenDoos ? `tarra ${gekozenDoos.tarra_gram} g` : undefined}
              >
                <input
                  className={`${invoerClasses} geen-spinner`}
                  value={gewicht}
                  onChange={(e) => setGewicht(e.target.value.replace(/[^0-9]/g, ""))}
                  inputMode="numeric"
                  placeholder="0"
                />
              </Veld>
              <Veld label="Vervoerder">
                <input
                  className={invoerClasses}
                  value={vervoerder}
                  onChange={(e) => setVervoerder(e.target.value)}
                />
              </Veld>
            </div>

            <Knop onClick={inpakken} disabled={bezig || !alsGecontroleerd} className="w-full">
              <Icon name="box" size={18} />
              {bezig ? "Bezig…" : "Doos dicht"}
            </Knop>

            {!alsGecontroleerd && magForceren && (
              <button
                type="button"
                onClick={forceerInpakken}
                className="w-full text-xs text-slate underline underline-offset-2"
              >
                Controle overslaan (teamleider)
              </button>
            )}
          </div>
        </Kaart>
      )}

      {zending.status === "ingepakt" && (
        <Kaart titel="Verzenden">
          <div className="space-y-3">
            <div className="text-sm text-slate">
              Doos {zending.doos_type} · {zending.gewicht_gram ?? "?"} gram ·{" "}
              {zending.vervoerder}
            </div>
            <Veld
              label="Trackingnummer"
              hint="Van het label. Mag leeg blijven als je dat later invult."
            >
              <input
                data-scan
                className={invoerClasses}
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
                placeholder="Scan of typ het trackingnummer"
              />
            </Veld>
            <Melding soort="warn">
              Verzenden boekt de inhoud uit het magazijn. Doe dit pas als de doos
              daadwerkelijk meegaat.
            </Melding>
            <Knop onClick={verzenden} disabled={bezig} className="w-full">
              {bezig ? "Bezig…" : "Verzenden en afboeken"}
            </Knop>
          </div>
        </Kaart>
      )}

      {zending.status === "verzonden" && (
        <Melding soort="ok">
          <span className="flex items-center gap-2">
            <Icon name="vink" size={16} />
            Verzonden{zending.tracking ? ` — ${zending.tracking}` : ""}.
          </span>
        </Melding>
      )}

      <Kaart titel={`Inhoud (${regels.length})`}>
        {regels.length === 0 ? (
          <LeegState tekst="Deze zending is leeg." />
        ) : (
          <ul className="divide-y divide-navy-100">
            {regels.map((r) => (
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
                {r.gecontroleerd ? (
                  <Icon name="vink" size={18} className="shrink-0 text-ok" />
                ) : (
                  <span className="shrink-0 text-xs text-slate">nog scannen</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Kaart>
    </div>
  );
}
