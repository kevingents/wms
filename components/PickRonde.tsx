"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ScanVeld } from "@/components/ScanVeld";
import { Kaart, Knop, Melding, LeegState } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import { nieuweSleutel } from "@/lib/outbox";
import { cn } from "@/lib/cn";
import type { PickOpdracht, PickRegel } from "@/lib/picken";

/**
 * De pickronde — één regel tegelijk, groot in beeld.
 *
 * Waarom niet de hele lijst tegelijk: een picker loopt met een scanner in één
 * hand en een doos in de andere. Eén opdracht per scherm, in looprichting, met
 * de locatiecode als grootste element. De lijst eronder is er om te zien hoe ver
 * je bent, niet om uit te werken.
 *
 * Picken gaat bewust NIET via de offline-outbox: de bevestiging boekt tegen de
 * voorraad op dát moment en kan een vervolgregel opleveren. Een pick die een uur
 * later alsnog verstuurd wordt, zou tegen een achterhaalde situatie boeken.
 */

export function PickRonde({
  opdracht: initieel,
  regels: initieleRegels,
  scanLocatieVerplicht,
  scanArtikelVerplicht,
}: {
  opdracht: PickOpdracht;
  regels: PickRegel[];
  scanLocatieVerplicht: boolean;
  scanArtikelVerplicht: boolean;
}) {
  const router = useRouter();
  const [opdracht, setOpdracht] = useState(initieel);
  const [regels, setRegels] = useState(initieleRegels);
  const [locatieOk, setLocatieOk] = useState(false);
  const [artikelOk, setArtikelOk] = useState(false);
  const [locatieInvoer, setLocatieInvoer] = useState("");
  const [artikelInvoer, setArtikelInvoer] = useState("");
  const [minderOpen, setMinderOpen] = useState(false);
  const [gevonden, setGevonden] = useState("");
  const [fout, setFout] = useState("");
  const [melding, setMelding] = useState("");
  const [bezig, setBezig] = useState(false);

  const open = useMemo(() => regels.filter((r) => r.status === "open"), [regels]);
  const huidig = open[0] ?? null;
  const gedaan = regels.length - open.length;

  /* Nieuwe regel = alles opnieuw scannen. Anders zou de bevestiging van de vorige
     locatie blijven staan en kun je per ongeluk het verkeerde vak leegtrekken. */
  const huidigId = huidig?.id ?? null;
  const vorigeRegel = useRef<number | null>(null);
  useEffect(() => {
    if (vorigeRegel.current === huidigId) return;
    vorigeRegel.current = huidigId;
    setLocatieOk(false);
    setArtikelOk(false);
    setLocatieInvoer("");
    setArtikelInvoer("");
    setMinderOpen(false);
    setGevonden("");
    setFout("");
  }, [huidigId]);

  async function starten() {
    setBezig(true);
    try {
      const res = await fetch(`/api/picken/${opdracht.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actie: "start" }),
      });
      const data = await res.json();
      if (data.ok && data.opdracht) setOpdracht(data.opdracht);
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

  async function bevestig(aantal: number) {
    if (!huidig) return;
    setBezig(true);
    setFout("");
    setMelding("");
    try {
      const res = await fetch("/api/picken/regel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          regelId: huidig.id,
          aantal,
          idempotencyKey: nieuweSleutel(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Bevestigen mislukt.");
        return;
      }

      if (aantal < huidig.gevraagd) {
        setMelding(
          data.vervolgRegelId
            ? `${aantal} van ${huidig.gevraagd} gepikt. De rest is toegewezen aan een andere locatie — die staat verderop in de lijst.`
            : `${aantal} van ${huidig.gevraagd} gepikt. De rest ligt nergens anders in het magazijn.`
        );
      }
      /* De server kan een vervolgregel hebben gemaakt, dus we halen de hele
         opdracht opnieuw op in plaats van lokaal bij te werken. */
      await verversen();
    } catch {
      setFout("Geen verbinding — de pick is niet geboekt. Probeer opnieuw.");
    } finally {
      setBezig(false);
    }
  }

  async function overslaan() {
    if (!huidig) return;
    setBezig(true);
    try {
      await fetch("/api/picken/regel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          regelId: huidig.id,
          actie: "overslaan",
          reden: "Overgeslagen door picker",
        }),
      });
      await verversen();
    } finally {
      setBezig(false);
    }
  }

  async function verversen() {
    const res = await fetch(`/api/picken/${opdracht.id}`);
    const data = await res.json();
    if (data.ok) {
      setOpdracht(data.opdracht);
      setRegels(data.regels);
    }
  }

  async function verzenden() {
    setBezig(true);
    setFout("");
    try {
      const res = await fetch(`/api/picken/${opdracht.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actie: "verzenden" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Verzenden mislukt.");
        return;
      }
      router.push("/picken");
      router.refresh();
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
            <div className="font-mono text-sm font-semibold">{opdracht.code}</div>
            <div className="text-sm text-slate">
              {opdracht.bestemming || "geen bestemming"} · {opdracht.stuks} stuks
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tabular-nums">
              {gedaan}/{regels.length}
            </div>
            <div className="text-xs text-slate">regels gedaan</div>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-navy-50">
          <div
            className="h-full rounded-full bg-navy transition-all"
            style={{ width: `${regels.length ? (gedaan / regels.length) * 100 : 0}%` }}
          />
        </div>
      </Kaart>

      {melding && <Melding soort="warn">{melding}</Melding>}
      {fout && <Melding soort="bad">{fout}</Melding>}

      {opdracht.status === "open" && (
        <Kaart>
          <p className="mb-3 text-sm text-slate">
            Deze opdracht staat nog op je te wachten. Bij starten wordt hij aan jou
            toegewezen, zodat een collega niet dezelfde ronde loopt.
          </p>
          <Knop onClick={starten} disabled={bezig} className="w-full">
            {bezig ? "Bezig…" : "Ronde starten"}
          </Knop>
        </Kaart>
      )}

      {opdracht.status !== "open" && huidig && (
        <Kaart>
          {!huidig.location_id ? (
            <div className="space-y-3">
              <Melding soort="bad">
                Voor dit artikel is geen voorraad in het magazijn toegewezen. Meld dit bij
                je teamleider of sla de regel over.
              </Melding>
              <div>
                <div className="font-semibold">{huidig.omschrijving || huidig.sku}</div>
                <div className="font-mono text-xs text-slate">{huidig.sku}</div>
              </div>
              <Knop variant="secundair" onClick={overslaan} disabled={bezig}>
                Regel overslaan
              </Knop>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg bg-navy p-4 text-white">
                <div className="text-xs uppercase tracking-widest text-white/60">
                  Loop naar
                </div>
                <div className="font-mono text-4xl font-bold">{huidig.location_code}</div>
                {huidig.zone && (
                  <div className="mt-0.5 text-sm text-white/70">zone {huidig.zone}</div>
                )}
              </div>

              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{huidig.omschrijving || huidig.sku}</div>
                  <div className="text-sm text-slate">
                    {[huidig.merk, huidig.kleur, huidig.maat].filter(Boolean).join(" · ")}
                  </div>
                  <div className="font-mono text-xs text-slate">{huidig.sku}</div>
                  {huidig.note && (
                    <div className="mt-1 text-xs text-warn">{huidig.note}</div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-4xl font-bold tabular-nums">{huidig.gevraagd}</div>
                  <div className="text-xs text-slate">te pikken</div>
                </div>
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

              {!minderOpen ? (
                <div className="space-y-2">
                  <Knop
                    onClick={() => bevestig(huidig.gevraagd)}
                    disabled={!magBevestigen || bezig}
                    className="w-full"
                  >
                    <Icon name="vink" size={18} />
                    {bezig ? "Bezig…" : `${huidig.gevraagd} gepikt`}
                  </Knop>
                  <button
                    type="button"
                    onClick={() => setMinderOpen(true)}
                    disabled={!magBevestigen}
                    className="w-full text-sm text-slate underline underline-offset-2 disabled:opacity-40"
                  >
                    Minder gevonden
                  </button>
                </div>
              ) : (
                <div className="space-y-2 rounded-lg border border-warn bg-warn-50 p-3">
                  <span className="block text-sm font-medium text-warn">
                    Hoeveel lagen er echt?
                  </span>
                  <input
                    value={gevonden}
                    onChange={(e) => setGevonden(e.target.value.replace(/[^0-9]/g, ""))}
                    inputMode="numeric"
                    autoFocus
                    placeholder="0"
                    className="geen-spinner min-h-tap w-full rounded-lg border-2 border-warn bg-white px-3 text-center text-3xl font-bold tabular-nums focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <Knop
                      onClick={() => bevestig(Number(gevonden))}
                      disabled={gevonden === "" || Number(gevonden) > huidig.gevraagd || bezig}
                      className="flex-1"
                    >
                      Vastleggen
                    </Knop>
                    <Knop variant="secundair" onClick={() => setMinderOpen(false)}>
                      Terug
                    </Knop>
                  </div>
                  <p className="text-xs text-warn">
                    Het verschil wordt niet afgeboekt. De rest wordt op een andere locatie
                    gezocht; is die er niet, dan blijft het als tekort zichtbaar.
                  </p>
                </div>
              )}
            </div>
          )}
        </Kaart>
      )}

      {opdracht.status !== "open" && !huidig && (
        <Kaart>
          <div className="space-y-3">
            <Melding soort="ok">
              <span className="flex items-center gap-2">
                <Icon name="vink" size={16} />
                Alle regels afgehandeld.
              </span>
            </Melding>
            {opdracht.status === "afgesloten" ? (
              <p className="text-sm text-slate">
                Deze opdracht is verzonden en het pand uit geboekt.
              </p>
            ) : (
              <>
                <p className="text-sm text-slate">
                  De goederen staan nu op expeditie. Bij verzenden gaan ze het pand uit en
                  verlaten ze de magazijnvoorraad.
                </p>
                <Knop onClick={verzenden} disabled={bezig} className="w-full">
                  {bezig ? "Bezig…" : "Verzenden en afsluiten"}
                </Knop>
              </>
            )}
          </div>
        </Kaart>
      )}

      <Kaart titel={`Alle regels (${regels.length})`}>
        {regels.length === 0 ? (
          <LeegState tekst="Deze opdracht heeft geen regels." />
        ) : (
          <ul className="divide-y divide-navy-100">
            {regels.map((r) => (
              <li
                key={r.id}
                className={cn(
                  "flex items-center gap-3 py-2 text-sm",
                  r.id === huidig?.id && "-mx-2 rounded bg-navy-50 px-2"
                )}
              >
                <span className="w-20 shrink-0 font-mono text-xs">
                  {r.location_code ?? <span className="text-bad">geen</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{r.omschrijving || r.sku}</span>
                  <span className="block truncate font-mono text-xs text-slate">
                    {r.sku}
                    {r.maat ? ` · ${r.maat}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  {r.status === "open" ? (
                    <span className="font-semibold">{r.gevraagd}</span>
                  ) : (
                    <span
                      className={
                        r.status === "gepikt"
                          ? "text-ok"
                          : r.status === "kort"
                            ? "text-warn"
                            : "text-slate"
                      }
                    >
                      {r.gepikt}/{r.gevraagd}
                    </span>
                  )}
                </span>
                <span className="w-5 shrink-0">
                  {r.status === "gepikt" && <Icon name="vink" size={16} className="text-ok" />}
                  {r.status === "kort" && <Icon name="alert" size={16} className="text-warn" />}
                  {r.status === "overgeslagen" && (
                    <Icon name="kruis" size={16} className="text-slate" />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Kaart>
    </div>
  );
}
