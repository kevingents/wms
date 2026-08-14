"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScanVeld } from "@/components/ScanVeld";
import { Kaart, Knop, Melding, Veld, LeegState, invoerClasses } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import { nieuweSleutel } from "@/lib/outbox";
import { cn } from "@/lib/cn";
import type { Ontvangst, OntvangstRegel } from "@/lib/ontvangst";

/**
 * Uitpakken tegen de verwachting.
 *
 * Blind: het verwachte aantal staat er pas ná invoer. Wie ziet dat er tien
 * verwacht worden, telt er tien — ook als er negen liggen. Dat is geen
 * onwil maar hoe mensen werken, en het is precies wat je bij ontvangst niet
 * wilt, want dit is de laatste plek waar je een leveranciersfout kunt vangen.
 */
export function OntvangstView({
  ontvangst,
  regels: initieleRegels,
  standaardLocatie,
}: {
  ontvangst: Ontvangst;
  regels: OntvangstRegel[];
  standaardLocatie: string;
}) {
  const router = useRouter();
  const [regels, setRegels] = useState(initieleRegels);
  const [status, setStatus] = useState(ontvangst.status);
  const [actief, setActief] = useState<OntvangstRegel | null>(null);
  const [scanCode, setScanCode] = useState("");
  const [aantal, setAantal] = useState("");
  const [afgekeurd, setAfgekeurd] = useState("");
  const [locatie, setLocatie] = useState(standaardLocatie);
  const [redenAfkeur, setRedenAfkeur] = useState("");
  const [fout, setFout] = useState("");
  const [melding, setMelding] = useState("");
  const [bezig, setBezig] = useState(false);

  const open = regels.filter((r) => r.status === "open");

  async function verversen() {
    const res = await fetch(`/api/ontvangst/${ontvangst.id}`);
    const data = await res.json();
    if (data.ok) {
      setRegels(data.regels);
      setStatus(data.ontvangst.status);
    }
  }

  async function starten() {
    setBezig(true);
    try {
      await fetch("/api/ontvangst", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actie: "start", id: ontvangst.id }),
      });
      setStatus("bezig");
      await verversen();
    } finally {
      setBezig(false);
    }
  }

  /** Scan zoekt de regel op; staat hij er niet, dan is het een extra levering. */
  async function scan(code: string) {
    setFout("");
    setMelding("");
    const schoon = code.trim().toUpperCase();
    const treffer = regels.find(
      (r) =>
        r.status === "open" &&
        (r.sku.toUpperCase() === schoon || r.barcode?.toUpperCase() === schoon)
    );

    if (treffer) {
      setActief(treffer);
      setScanCode("");
      setAantal("");
      setAfgekeurd("");
      setRedenAfkeur("");
      return;
    }

    const alAf = regels.find(
      (r) => r.sku.toUpperCase() === schoon || r.barcode?.toUpperCase() === schoon
    );
    if (alAf) {
      setFout("Dit artikel is al afgehandeld op deze levering.");
      setScanCode("");
      return;
    }

    /* Niet op de pakbon: toevoegen als onverwachte regel, met verwacht 0. Zo
       komt het als afwijking bovendrijven in plaats van te verdwijnen. */
    setBezig(true);
    try {
      const res = await fetch("/api/ontvangst", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actie: "extra", id: ontvangst.id, sku: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Onbekend artikel.");
        setScanCode("");
        return;
      }
      setMelding("Dit stond niet op de pakbon — toegevoegd als afwijking.");
      await verversen();
      setActief(data.regel);
      setScanCode("");
      setAantal("");
    } finally {
      setBezig(false);
    }
  }

  async function boeken() {
    if (!actief || aantal === "") return;
    setBezig(true);
    setFout("");
    try {
      const res = await fetch("/api/ontvangst", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actie: "boek",
          regelId: actief.id,
          ontvangen: Number(aantal),
          afgekeurd: Number(afgekeurd || 0),
          locatieCode: locatie,
          redenAfkeur: redenAfkeur || null,
          idempotencyKey: nieuweSleutel(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Boeken mislukt.");
        return;
      }
      const verschil = Number(aantal) - actief.verwacht;
      if (verschil !== 0) {
        setMelding(
          `Afwijking vastgelegd: ${verschil > 0 ? "+" : ""}${verschil} ten opzichte van de verwachting.`
        );
      }
      setActief(null);
      setAantal("");
      setAfgekeurd("");
      setRedenAfkeur("");
      await verversen();
      router.refresh();
    } catch {
      setFout("Geen verbinding — niet geboekt.");
    } finally {
      setBezig(false);
    }
  }

  async function overslaan(regel: OntvangstRegel) {
    setBezig(true);
    try {
      await fetch("/api/ontvangst", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actie: "overslaan",
          regelId: regel.id,
          reden: "Niet geleverd",
        }),
      });
      if (actief?.id === regel.id) setActief(null);
      await verversen();
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="space-y-4">
      <Kaart>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-mono text-sm font-semibold">{ontvangst.code}</div>
            <div className="text-sm text-slate">
              {ontvangst.leverancier || "geen leverancier"}
              {ontvangst.referentie ? ` · ${ontvangst.referentie}` : ""}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums">
              {regels.length - open.length}/{regels.length}
            </div>
            <div className="text-xs text-slate">regels</div>
          </div>
        </div>
      </Kaart>

      {melding && <Melding soort="warn">{melding}</Melding>}
      {fout && <Melding soort="bad">{fout}</Melding>}

      {status === "verwacht" && (
        <Kaart>
          <p className="mb-3 text-sm text-slate">
            Zet de pallet bij de ontvangstkade en begin met uitpakken. Het verwachte
            aantal blijft verborgen tot je geteld hebt.
          </p>
          <Knop onClick={starten} disabled={bezig} className="w-full">
            {bezig ? "Bezig…" : "Beginnen met uitpakken"}
          </Knop>
        </Kaart>
      )}

      {status === "bezig" && (
        <Kaart>
          <div className="space-y-4">
            {!actief ? (
              <ScanVeld
                label="Scan het artikel dat je uitpakt"
                placeholder="Barcode of SKU"
                waarde={scanCode}
                onWaarde={setScanCode}
                onScan={scan}
                actief
              />
            ) : (
              <>
                <div className="rounded-lg bg-navy-50 p-3">
                  <div className="font-semibold">{actief.omschrijving || actief.sku}</div>
                  <div className="text-sm text-slate">
                    {[actief.merk, actief.kleur, actief.maat].filter(Boolean).join(" · ")}
                  </div>
                  <div className="font-mono text-xs text-slate">{actief.sku}</div>
                </div>

                <div>
                  <span className="mb-1 block text-sm font-medium text-slate">
                    Hoeveel heb je geteld?
                  </span>
                  <input
                    value={aantal}
                    onChange={(e) => setAantal(e.target.value.replace(/[^0-9]/g, ""))}
                    inputMode="numeric"
                    autoFocus
                    placeholder="0"
                    className="geen-spinner min-h-tap w-full rounded-lg border-2 border-navy-100 bg-white px-3 text-center text-3xl font-bold tabular-nums focus:border-navy focus:outline-none"
                  />
                  {aantal !== "" && (
                    <p className="mt-1 text-xs text-slate">
                      Verwacht: {actief.verwacht}
                      {Number(aantal) !== actief.verwacht && (
                        <span className="ml-1 font-semibold text-warn">
                          ({Number(aantal) - actief.verwacht > 0 ? "+" : ""}
                          {Number(aantal) - actief.verwacht})
                        </span>
                      )}
                    </p>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Veld label="Naar locatie" hint="Waar leg je het neer">
                    <input
                      data-scan
                      className={invoerClasses}
                      value={locatie}
                      onChange={(e) => setLocatie(e.target.value)}
                    />
                  </Veld>
                  <Veld label="Waarvan beschadigd" hint="Gaat naar quarantaine">
                    <input
                      className={`${invoerClasses} geen-spinner`}
                      value={afgekeurd}
                      onChange={(e) => setAfgekeurd(e.target.value.replace(/[^0-9]/g, ""))}
                      inputMode="numeric"
                      placeholder="0"
                    />
                  </Veld>
                </div>

                {Number(afgekeurd) > 0 && (
                  <Veld label="Wat is er mis?">
                    <input
                      className={invoerClasses}
                      value={redenAfkeur}
                      onChange={(e) => setRedenAfkeur(e.target.value)}
                      placeholder="bv. doos nat geworden"
                    />
                  </Veld>
                )}

                <div className="flex gap-2">
                  <Knop onClick={boeken} disabled={bezig || aantal === ""} className="flex-1">
                    {bezig ? "Bezig…" : "Inboeken"}
                  </Knop>
                  <Knop variant="secundair" onClick={() => setActief(null)}>
                    Terug
                  </Knop>
                </div>
              </>
            )}
          </div>
        </Kaart>
      )}

      <Kaart titel={`Regels (${regels.length})`}>
        {regels.length === 0 ? (
          <LeegState tekst="Deze levering heeft geen regels." />
        ) : (
          <ul className="divide-y divide-navy-100">
            {regels.map((r) => (
              <li
                key={r.id}
                className={cn(
                  "flex items-center gap-3 py-2 text-sm",
                  r.id === actief?.id && "-mx-2 rounded bg-navy-50 px-2"
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{r.omschrijving || r.sku}</span>
                  <span className="block truncate font-mono text-xs text-slate">
                    {r.sku}
                    {r.maat ? ` · ${r.maat}` : ""}
                    {r.locatie_code ? ` → ${r.locatie_code}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  {r.status === "open" ? (
                    <span className="text-slate">— / {r.verwacht}</span>
                  ) : (
                    <span
                      className={
                        r.status === "ontvangen"
                          ? "font-semibold text-ok"
                          : "font-semibold text-warn"
                      }
                    >
                      {r.ontvangen} / {r.verwacht}
                      {r.afgekeurd > 0 && (
                        <span className="ml-1 text-bad">({r.afgekeurd} afg.)</span>
                      )}
                    </span>
                  )}
                </span>
                {r.status === "open" && status === "bezig" && (
                  <button
                    type="button"
                    onClick={() => overslaan(r)}
                    disabled={bezig}
                    className="shrink-0 text-xs text-slate underline underline-offset-2"
                  >
                    niet geleverd
                  </button>
                )}
                {r.status === "ontvangen" && (
                  <Icon name="vink" size={16} className="shrink-0 text-ok" />
                )}
                {r.status === "afwijking" && (
                  <Icon name="alert" size={16} className="shrink-0 text-warn" />
                )}
              </li>
            ))}
          </ul>
        )}
      </Kaart>
    </div>
  );
}
