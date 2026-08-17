"use client";

import { useEffect, useState } from "react";
import { Kaart, Knop, Melding, Veld, Kental, LeegState, invoerClasses } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { LABEL_SOORTEN, type LabelSoort, type LocatieZonderLabel, type PrintRegel } from "@/lib/labels";

/**
 * Labels printen.
 *
 * Dit scherm bestaat omdat het scansysteem zonder geplakte labels niet werkt.
 * Daarom staat het aantal vakken zónder label bovenaan en groot: dat is de enige
 * cijfer dat zegt hoe ver het magazijn is met in gebruik nemen.
 *
 * Twee uitvoerwegen, omdat magazijnen verschillen: ZPL voor een Zebra-etiket-
 * printer, of een afdrukbare pagina voor een gewone printer met etikettenvellen.
 */

interface Stand {
  actieve_locaties: number;
  zonder_label: number;
}

interface Formaat {
  breedteMm: number;
  hoogteMm: number;
  dpi: number;
  naam: string;
}

export function LabelsView() {
  const [stand, setStand] = useState<Stand | null>(null);
  const [formaat, setFormaat] = useState<Formaat | null>(null);
  const [taal, setTaal] = useState<"zpl" | "html">("zpl");
  const [zonderLabel, setZonderLabel] = useState<LocatieZonderLabel[]>([]);
  const [prints, setPrints] = useState<PrintRegel[]>([]);

  const [soort, setSoort] = useState<LabelSoort>("locatie");
  const [gekozen, setGekozen] = useState<string[]>([]);
  const [handmatig, setHandmatig] = useState("");
  const [aantal, setAantal] = useState("1");
  const [fout, setFout] = useState("");
  const [melding, setMelding] = useState("");
  const [bezig, setBezig] = useState(false);

  async function laden() {
    const res = await fetch("/api/labels");
    const data = await res.json();
    if (data.ok) {
      setStand(data.stand);
      setFormaat(data.formaat);
      setTaal(data.taal);
      setZonderLabel(data.zonderLabel);
      setPrints(data.prints);
    }
  }

  useEffect(() => {
    void laden();
  }, []);

  /* Handmatig getypte codes vullen aan op de aangevinkte vakken; bij artikelen
     is er niets aan te vinken en is dit de enige ingang. */
  const codes = [
    ...gekozen,
    ...handmatig
      .split(/[\s,;\n]+/)
      .map((c) => c.trim())
      .filter(Boolean),
  ];

  async function genereer(voorbeeld: boolean) {
    setBezig(true);
    setFout("");
    setMelding("");
    try {
      const res = await fetch("/api/labels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ soort, codes, aantal: Number(aantal) || 1, taal, voorbeeld }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Labels maken mislukt.");
        return;
      }

      const b = data.bestand as {
        taal: string;
        mime: string;
        bestandsnaam: string;
        inhoud: string;
        aantalLabels: number;
      };

      if (b.taal === "html") {
        /* Een eigen venster i.p.v. een download: dan kan de medewerker meteen
           op printen drukken en het resultaat zien vóór het papier erdoor gaat. */
        const venster = window.open("", "_blank");
        if (!venster) {
          setFout("De browser blokkeerde het printvenster. Sta pop-ups toe voor deze site.");
          return;
        }
        venster.document.write(b.inhoud);
        venster.document.close();
        if (!voorbeeld) venster.focus();
      } else {
        const blob = new Blob([b.inhoud], { type: b.mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = b.bestandsnaam;
        a.click();
        URL.revokeObjectURL(url);
      }

      setMelding(
        voorbeeld
          ? `Voorbeeld van ${b.aantalLabels} label(s) — niet vastgelegd.`
          : `${b.aantalLabels} label(s) gemaakt en vastgelegd.`
      );
      if (!voorbeeld) {
        setGekozen([]);
        await laden();
      }
    } catch {
      setFout("Geen verbinding met de server.");
    } finally {
      setBezig(false);
    }
  }

  const perZone = zonderLabel.reduce<Record<string, LocatieZonderLabel[]>>((acc, l) => {
    const z = l.zone || "zonder zone";
    (acc[z] ||= []).push(l);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {melding && <Melding soort="ok">{melding}</Melding>}
      {fout && <Melding soort="bad">{fout}</Melding>}

      <div className="grid grid-cols-2 gap-3">
        <Kental
          label="Vakken zonder label"
          waarde={stand ? stand.zonder_label.toLocaleString("nl-NL") : "—"}
          soort={stand && stand.zonder_label > 0 ? "warn" : "ok"}
          toelichting="deze kun je nog niet scannen"
        />
        <Kental
          label="Actieve locaties"
          waarde={stand ? stand.actieve_locaties.toLocaleString("nl-NL") : "—"}
          toelichting={formaat ? `etiket ${formaat.naam} @ ${formaat.dpi} dpi` : undefined}
        />
      </div>

      <Kaart titel="Labels maken">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {LABEL_SOORTEN.map((s) => (
              <button
                key={s.waarde}
                type="button"
                onClick={() => {
                  setSoort(s.waarde);
                  setGekozen([]);
                }}
                className={cn(
                  "min-h-tap rounded-lg border-2 px-3 py-2 text-left",
                  soort === s.waarde
                    ? "border-navy bg-navy text-white"
                    : "border-navy-100 bg-white text-navy"
                )}
              >
                <span className="block text-sm font-semibold">{s.label}</span>
                <span
                  className={cn(
                    "block text-[11px] leading-tight",
                    soort === s.waarde ? "text-white/70" : "text-slate"
                  )}
                >
                  {s.uitleg}
                </span>
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Veld label="Aantal per label" hint="Meer dan één bij dubbele stickers">
              <input
                className={`${invoerClasses} geen-spinner`}
                value={aantal}
                onChange={(e) => setAantal(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
              />
            </Veld>
            <Veld label="Uitvoer" hint="ZPL voor een Zebra, pagina voor papier">
              <select
                className={invoerClasses}
                value={taal}
                onChange={(e) => setTaal(e.target.value as "zpl" | "html")}
              >
                <option value="zpl">ZPL (labelprinter)</option>
                <option value="html">Afdrukbare pagina</option>
              </select>
            </Veld>
            <Veld label="Gekozen" hint="Aangevinkt plus getypt">
              <div className="flex min-h-tap items-center rounded-lg border border-navy-100 bg-navy-50 px-3 text-lg font-bold tabular-nums">
                {codes.length}
              </div>
            </Veld>
          </div>

          <Veld
            label="Codes intypen of scannen"
            hint="Gescheiden door spatie, komma of enter. Bij artikelen is dit de enige ingang."
          >
            <textarea
              className={`${invoerClasses} min-h-24 py-2 font-mono text-sm`}
              value={handmatig}
              onChange={(e) => setHandmatig(e.target.value)}
              placeholder={soort === "locatie" ? "H01 1A1 H01 1B1" : "2900001326124"}
            />
          </Veld>

          <div className="flex flex-wrap gap-2">
            <Knop onClick={() => genereer(false)} disabled={bezig || codes.length === 0}>
              <Icon name="label" size={18} />
              {bezig ? "Bezig…" : `${codes.length} label(s) printen`}
            </Knop>
            <Knop
              variant="secundair"
              onClick={() => genereer(true)}
              disabled={bezig || codes.length === 0}
            >
              Alleen voorbeeld
            </Knop>
          </div>
        </div>
      </Kaart>

      {soort === "locatie" && (
        <Kaart
          titel={`Vakken zonder label (${zonderLabel.length})`}
          actie={
            zonderLabel.length > 0 && (
              <Knop
                variant="secundair"
                onClick={() =>
                  setGekozen(zonderLabel.slice(0, 200).map((l) => l.code))
                }
              >
                Selecteer eerste 200
              </Knop>
            )
          }
        >
          {zonderLabel.length === 0 ? (
            <LeegState tekst="Elk actief vak heeft een label gehad." />
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate">
                Zonder geplakt label kan een medewerker dit vak niet scannen. Print ze per
                zone, dan kun je ze in één ronde plakken.
              </p>
              {Object.entries(perZone).map(([zone, lijst]) => (
                <div key={zone}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-semibold text-navy">
                      Zone {zone} — {lijst.length} vakken
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setGekozen((g) => [
                          ...new Set([...g, ...lijst.map((l) => l.code)]),
                        ])
                      }
                      className="text-xs text-navy underline underline-offset-2"
                    >
                      hele zone kiezen
                    </button>
                  </div>
                  <ul className="flex flex-wrap gap-1.5">
                    {lijst.slice(0, 60).map((l) => {
                      const aan = gekozen.includes(l.code);
                      return (
                        <li key={l.id}>
                          <button
                            type="button"
                            onClick={() =>
                              setGekozen((g) =>
                                aan ? g.filter((c) => c !== l.code) : [...g, l.code]
                              )
                            }
                            className={cn(
                              "rounded border px-2 py-1 font-mono text-xs",
                              aan
                                ? "border-navy bg-navy text-white"
                                : "border-navy-100 bg-white"
                            )}
                          >
                            {l.code}
                          </button>
                        </li>
                      );
                    })}
                    {lijst.length > 60 && (
                      <li className="px-2 py-1 text-xs text-slate">
                        … en {lijst.length - 60} meer in deze zone
                      </li>
                    )}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Kaart>
      )}

      <Kaart titel="Recent geprint">
        {prints.length === 0 ? (
          <LeegState tekst="Nog niets geprint." />
        ) : (
          <ul className="divide-y divide-navy-100">
            {prints.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-20 shrink-0 text-xs text-slate">{p.soort}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {p.object_id}
                </span>
                <span className="shrink-0 tabular-nums text-slate">{p.aantal}×</span>
                <span className="w-28 shrink-0 truncate text-right text-xs text-slate">
                  {p.geprint_door}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Kaart>
    </div>
  );
}
