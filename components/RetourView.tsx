"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScanVeld } from "@/components/ScanVeld";
import { Kaart, Knop, Melding, Veld, LeegState, invoerClasses } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { Retour, RetourRegel, Oordeel } from "@/lib/retouren";

/**
 * De retourbalie.
 *
 * Aannemen en beoordelen in één scherm, want dat is één handeling: de doos ligt
 * open, jij kijkt naar het artikel, en op dat moment weet je of het terug de
 * verkoop in kan. Dat later doen betekent alles twee keer aanraken.
 *
 * Er is bewust geen "beslis later"-knop. Wel een stapel HERSTEL waar twijfel-
 * gevallen heen kunnen — maar dan staat het tenminste ergens en niet nergens.
 */

const OORDELEN: { waarde: Oordeel; label: string; uitleg: string; kleur: string }[] = [
  {
    waarde: "verkoopbaar",
    label: "Verkoopbaar",
    uitleg: "Terug het schap in",
    kleur: "border-ok bg-ok-50 text-ok",
  },
  {
    waarde: "herstel",
    label: "Herstel",
    uitleg: "Reinigen of repareren",
    kleur: "border-warn bg-warn-50 text-warn",
  },
  {
    waarde: "afkeur",
    label: "Afkeur",
    uitleg: "Niet meer verkoopbaar",
    kleur: "border-bad bg-bad-50 text-bad",
  },
];

export function RetourView({
  retouren: initieel,
  standaardLocatie,
}: {
  retouren: Retour[];
  standaardLocatie: string;
}) {
  const router = useRouter();
  const [retouren, setRetouren] = useState(initieel);
  const [actief, setActief] = useState<{ retour: Retour; regels: RetourRegel[] } | null>(
    null
  );
  const [nieuwOpen, setNieuwOpen] = useState(false);
  const [bronRef, setBronRef] = useState("");
  const [scanCode, setScanCode] = useState("");
  const [nieuweRegels, setNieuweRegels] = useState<{ sku: string; aantal: number }[]>([]);
  const [locatie, setLocatie] = useState(standaardLocatie);
  const [reden, setReden] = useState("");
  const [fout, setFout] = useState("");
  const [melding, setMelding] = useState("");
  const [bezig, setBezig] = useState(false);

  async function verversLijst() {
    const res = await fetch("/api/retouren");
    const data = await res.json();
    if (data.ok) setRetouren(data.retouren);
  }

  async function open(id: number) {
    const res = await fetch(`/api/retouren?id=${id}`);
    const data = await res.json();
    if (data.ok) setActief({ retour: data.retour, regels: data.regels });
  }

  function voegToe(code: string) {
    const sku = code.trim();
    if (!sku) return;
    setNieuweRegels((r) => {
      const bestaand = r.find((x) => x.sku.toUpperCase() === sku.toUpperCase());
      if (bestaand) {
        return r.map((x) =>
          x.sku.toUpperCase() === sku.toUpperCase() ? { ...x, aantal: x.aantal + 1 } : x
        );
      }
      return [...r, { sku, aantal: 1 }];
    });
    setScanCode("");
  }

  async function aannemen() {
    if (nieuweRegels.length === 0) return;
    setBezig(true);
    setFout("");
    try {
      const res = await fetch("/api/retouren", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actie: "nieuw",
          bron: "webshop",
          bronRef: bronRef || null,
          regels: nieuweRegels,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Retour aannemen mislukt.");
        return;
      }
      setNieuweRegels([]);
      setBronRef("");
      setNieuwOpen(false);
      setMelding("Retour aangenomen en op de retourbalie geboekt.");
      await verversLijst();
      await open(data.retour.id);
      router.refresh();
    } catch {
      setFout("Geen verbinding met de server.");
    } finally {
      setBezig(false);
    }
  }

  async function beoordeel(regelId: number, oordeel: Oordeel) {
    setBezig(true);
    setFout("");
    try {
      const res = await fetch("/api/retouren", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actie: "beoordeel",
          regelId,
          oordeel,
          locatieCode: oordeel === "verkoopbaar" ? locatie : null,
          reden: reden || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Beoordelen mislukt.");
        return;
      }
      setReden("");
      if (actief) await open(actief.retour.id);
      await verversLijst();
      router.refresh();
    } finally {
      setBezig(false);
    }
  }

  const openRegels = actief?.regels.filter((r) => !r.oordeel) ?? [];

  return (
    <div className="space-y-4">
      {melding && <Melding soort="ok">{melding}</Melding>}
      {fout && <Melding soort="bad">{fout}</Melding>}

      <Kaart
        titel="Retour aannemen"
        actie={
          <Knop variant="secundair" onClick={() => setNieuwOpen(!nieuwOpen)}>
            <Icon name={nieuwOpen ? "kruis" : "plus"} size={16} />
            {nieuwOpen ? "Sluiten" : "Nieuwe retour"}
          </Knop>
        }
      >
        {!nieuwOpen ? (
          <p className="text-sm text-slate">
            Scan wat er terugkomt. Het wordt meteen op de retourbalie geboekt, zodat het
            niet onzichtbaar tussen de deur en de balie hangt.
          </p>
        ) : (
          <div className="space-y-3">
            <Veld label="Ordernummer" hint="Van de pakbon of het retourlabel">
              <input
                data-scan
                className={invoerClasses}
                value={bronRef}
                onChange={(e) => setBronRef(e.target.value)}
              />
            </Veld>

            <ScanVeld
              label="Scan de artikelen"
              placeholder="Barcode of SKU — nogmaals scannen telt op"
              waarde={scanCode}
              onWaarde={setScanCode}
              onScan={voegToe}
              actief
            />

            {nieuweRegels.length > 0 && (
              <ul className="divide-y divide-navy-100 rounded-lg border border-navy-100">
                {nieuweRegels.map((r) => (
                  <li key={r.sku} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-8 text-right font-bold tabular-nums">
                      {r.aantal}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                      {r.sku}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setNieuweRegels((x) => x.filter((y) => y.sku !== r.sku))
                      }
                      className="text-xs text-slate underline underline-offset-2"
                    >
                      weg
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <Knop onClick={aannemen} disabled={bezig || nieuweRegels.length === 0}>
              {bezig ? "Bezig…" : `${nieuweRegels.length} regels aannemen`}
            </Knop>
          </div>
        )}
      </Kaart>

      {actief && (
        <Kaart titel={`${actief.retour.code} beoordelen`}>
          {openRegels.length === 0 ? (
            <Melding soort="ok">
              <span className="flex items-center gap-2">
                <Icon name="vink" size={16} />
                Alles beoordeeld.
              </span>
            </Melding>
          ) : (
            <div className="space-y-4">
              {openRegels.map((r) => (
                <div key={r.id} className="rounded-lg border border-navy-100 p-3">
                  <div className="mb-2">
                    <div className="font-semibold">{r.omschrijving || r.sku}</div>
                    <div className="text-sm text-slate">
                      {[r.merk, r.kleur, r.maat].filter(Boolean).join(" · ")} ·{" "}
                      {r.aantal} stuks
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {OORDELEN.map((o) => (
                      <button
                        key={o.waarde}
                        type="button"
                        disabled={bezig}
                        onClick={() => beoordeel(r.id, o.waarde)}
                        className={cn(
                          "min-h-tap rounded-lg border-2 px-2 py-2 text-left disabled:opacity-50",
                          o.kleur
                        )}
                      >
                        <span className="block text-sm font-semibold">{o.label}</span>
                        <span className="block text-[11px] leading-tight opacity-80">
                          {o.uitleg}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <div className="grid gap-3 sm:grid-cols-2">
                <Veld label="Terug naar locatie" hint="Alleen bij verkoopbaar">
                  <input
                    data-scan
                    className={invoerClasses}
                    value={locatie}
                    onChange={(e) => setLocatie(e.target.value)}
                  />
                </Veld>
                <Veld label="Reden" hint="Bij herstel of afkeur">
                  <input
                    className={invoerClasses}
                    value={reden}
                    onChange={(e) => setReden(e.target.value)}
                    placeholder="bv. vlek op mouw"
                  />
                </Veld>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setActief(null)}
            className="mt-3 text-xs text-slate underline underline-offset-2"
          >
            Sluiten
          </button>
        </Kaart>
      )}

      <Kaart titel={`Openstaande retouren (${retouren.length})`}>
        {retouren.length === 0 ? (
          <LeegState tekst="Geen retouren open." />
        ) : (
          <ul className="divide-y divide-navy-100">
            {retouren.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => open(t.id)}
                  className="flex w-full items-center gap-3 py-3 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-sm font-semibold">{t.code}</span>
                    <span className="mt-0.5 block truncate text-sm text-slate">
                      {t.bron_ref || "geen order"} · {t.stuks} stuks
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-semibold tabular-nums">
                      {t.regels - t.open_regels}/{t.regels}
                    </span>
                    <span className="block text-xs text-slate">beoordeeld</span>
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
