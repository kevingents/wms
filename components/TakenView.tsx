"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Kaart, Knop, Melding, LeegState } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import { nieuweSleutel } from "@/lib/outbox";
import { cn } from "@/lib/cn";
import type { Taak, ReplenAdvies, TelKandidaat } from "@/lib/taken";

/**
 * De werkwachtrij.
 *
 * Eén lijst met alles wat er te doen is, op looproute. Een medewerker die niets
 * omhanden heeft pakt de bovenste; hij hoeft niet te kiezen tussen vier soorten
 * werk. Dát is wat een WMS onderscheidt van een voorraadlijst: het deelt werk
 * uit in plaats van het alleen te administreren.
 */

const SOORT_LABEL: Record<string, string> = {
  replenishment: "Aanvullen",
  telling: "Tellen",
  opruimen: "Opruimen",
  controle: "Controle",
  verplaatsing: "Verplaatsen",
};

const SOORT_ICON: Record<string, string> = {
  replenishment: "inslag",
  telling: "tellen",
  opruimen: "box",
  controle: "alert",
  verplaatsing: "scan",
};

export function TakenView({
  taken: initieel,
  replen,
  telkandidaten,
  magBeheren,
}: {
  taken: Taak[];
  replen: ReplenAdvies[];
  telkandidaten: TelKandidaat[];
  magBeheren: boolean;
}) {
  const router = useRouter();
  const [taken, setTaken] = useState(initieel);
  const [actief, setActief] = useState<Taak | null>(null);
  const [bronnen, setBronnen] = useState<
    { location_id: number; code: string; vrij: number }[]
  >([]);
  const [gekozenBron, setGekozenBron] = useState<number | null>(null);
  const [aantal, setAantal] = useState("");
  const [fout, setFout] = useState("");
  const [melding, setMelding] = useState("");
  const [bezig, setBezig] = useState(false);

  async function verversen() {
    const res = await fetch("/api/taken");
    const data = await res.json();
    if (data.ok) setTaken(data.taken);
  }

  async function actie(body: Record<string, unknown>) {
    setBezig(true);
    setFout("");
    try {
      const res = await fetch("/api/taken", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
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

  async function oppakken(t: Taak) {
    const data = await actie({ actie: "start", id: t.id });
    if (!data) return;
    setActief(data.taak);
    setAantal(String(t.aantal ?? ""));

    if (t.sku) {
      const res = await fetch(
        `/api/taken?bronnen=${encodeURIComponent(t.sku)}&behalve=${t.naar_locatie_id ?? ""}`
      );
      const b = await res.json();
      if (b.ok) {
        setBronnen(b.bronnen);
        setGekozenBron(b.bronnen[0]?.location_id ?? null);
      }
    }
    await verversen();
  }

  async function afronden() {
    if (!actief || !gekozenBron || !aantal) return;
    const data = await actie({
      actie: "afronden",
      id: actief.id,
      vanLocatieId: gekozenBron,
      aantal: Number(aantal),
      idempotencyKey: nieuweSleutel(),
    });
    if (data) {
      setActief(null);
      setBronnen([]);
      setMelding("Taak afgerond en geboekt.");
      await verversen();
      router.refresh();
    }
  }

  async function genereer(welke: "genereer-replen" | "plan-tellingen") {
    const data = await actie({ actie: welke });
    if (data) {
      setMelding(
        welke === "genereer-replen"
          ? `${data.gemaakt} aanvultaken gemaakt${data.overgeslagen ? `, ${data.overgeslagen} stonden al open` : ""}.`
          : `${data.gemaakt} telopdrachten ingepland.`
      );
      await verversen();
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      {melding && <Melding soort="ok">{melding}</Melding>}
      {fout && <Melding soort="bad">{fout}</Melding>}

      {actief && (
        <Kaart titel={`${SOORT_LABEL[actief.soort]} — taak ${actief.id}`}>
          <div className="space-y-4">
            <div className="rounded-lg bg-navy p-4 text-white">
              <div className="text-xs uppercase tracking-widest text-white/60">
                Breng naar
              </div>
              <div className="font-mono text-3xl font-bold">
                {actief.naar_code ?? actief.van_code ?? "?"}
              </div>
            </div>

            <div>
              <div className="font-semibold">{actief.omschrijving || actief.sku}</div>
              <div className="font-mono text-xs text-slate">{actief.sku}</div>
              {actief.reden && <div className="mt-1 text-xs text-warn">{actief.reden}</div>}
            </div>

            {bronnen.length === 0 ? (
              <Melding soort="warn">
                Dit artikel ligt nergens anders vrij. Annuleer de taak of meld het bij je
                teamleider.
              </Melding>
            ) : (
              <div>
                <span className="mb-1 block text-sm font-medium text-slate">
                  Haal het hier vandaan
                </span>
                <ul className="space-y-1.5">
                  {bronnen.map((b) => (
                    <li key={b.location_id}>
                      <button
                        type="button"
                        onClick={() => setGekozenBron(b.location_id)}
                        className={cn(
                          "flex min-h-tap w-full items-center gap-3 rounded-lg border-2 px-3 text-left",
                          gekozenBron === b.location_id
                            ? "border-navy bg-navy-50"
                            : "border-navy-100 bg-white"
                        )}
                      >
                        <span className="flex-1 font-mono font-semibold">{b.code}</span>
                        <span className="tabular-nums text-slate">{b.vrij} vrij</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <span className="mb-1 block text-sm font-medium text-slate">
                Hoeveel verplaats je?
              </span>
              <input
                value={aantal}
                onChange={(e) => setAantal(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                className="geen-spinner min-h-tap w-full rounded-lg border-2 border-navy-100 bg-white px-3 text-center text-3xl font-bold tabular-nums focus:border-navy focus:outline-none"
              />
            </div>

            <div className="flex gap-2">
              <Knop
                onClick={afronden}
                disabled={bezig || !gekozenBron || !aantal}
                className="flex-1"
              >
                {bezig ? "Bezig…" : "Afronden"}
              </Knop>
              <Knop variant="secundair" onClick={() => setActief(null)}>
                Later
              </Knop>
            </div>
          </div>
        </Kaart>
      )}

      <Kaart
        titel={`Werkvoorraad (${taken.length})`}
        actie={
          magBeheren && (
            <div className="flex gap-2">
              <Knop variant="secundair" onClick={() => genereer("genereer-replen")} disabled={bezig}>
                Aanvultaken
              </Knop>
              <Knop variant="secundair" onClick={() => genereer("plan-tellingen")} disabled={bezig}>
                Tellingen
              </Knop>
            </div>
          )
        }
      >
        {taken.length === 0 ? (
          <LeegState tekst="Geen openstaande taken. Alles bijgevuld en geteld." />
        ) : (
          <ul className="divide-y divide-navy-100">
            {taken.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-3">
                <Icon
                  name={SOORT_ICON[t.soort] ?? "box"}
                  size={20}
                  className="shrink-0 text-slate"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">
                      {SOORT_LABEL[t.soort] ?? t.soort}
                    </span>
                    <span className="font-mono text-xs text-slate">
                      {t.van_code ?? ""}
                      {t.van_code && t.naar_code ? " → " : ""}
                      {t.naar_code ?? ""}
                    </span>
                    {t.status === "bezig" && (
                      <span className="rounded bg-warn-100 px-2 py-0.5 text-xs text-warn">
                        {t.toegewezen_naam ?? "bezig"}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-slate">
                    {t.omschrijving || t.sku || t.reden}
                    {t.aantal ? ` · ${t.aantal} stuks` : ""}
                  </span>
                </span>
                <Knop variant="secundair" onClick={() => oppakken(t)} disabled={bezig}>
                  Oppakken
                </Knop>
              </li>
            ))}
          </ul>
        )}
      </Kaart>

      {magBeheren && replen.length > 0 && (
        <Kaart titel={`Piklocaties onder minimum (${replen.length})`}>
          <p className="mb-2 text-xs text-slate">
            Nog geen taak van gemaakt. Druk op Aanvultaken om ze in de wachtrij te zetten.
          </p>
          <ul className="divide-y divide-navy-100">
            {replen.slice(0, 15).map((r) => (
              <li key={r.pick_locatie_id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-24 shrink-0 font-mono text-xs">{r.pick_locatie}</span>
                <span className="min-w-0 flex-1 truncate">
                  {r.omschrijving || r.sku}
                </span>
                <span className="shrink-0 tabular-nums">
                  <span className={r.aanwezig === 0 ? "font-bold text-bad" : "text-warn"}>
                    {r.aanwezig}
                  </span>
                  <span className="text-slate">
                    /{r.min_voorraad}–{r.max_voorraad}
                  </span>
                </span>
                <span className="w-16 shrink-0 text-right text-xs text-slate">
                  {r.aan_te_vullen} vrij
                </span>
              </li>
            ))}
          </ul>
        </Kaart>
      )}

      {magBeheren && telkandidaten.length > 0 && (
        <Kaart titel="Vakken die een telling verdienen">
          <ul className="divide-y divide-navy-100">
            {telkandidaten.slice(0, 10).map((k) => (
              <li key={k.location_id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-24 shrink-0 font-mono text-xs">{k.locatie}</span>
                <span className="min-w-0 flex-1 text-slate">
                  {k.laatst_geteld
                    ? `${k.dagen_geleden} dagen geleden · ${k.mutaties_90d} mutaties`
                    : `nooit geteld · ${k.mutaties_90d} mutaties`}
                </span>
                <span className="shrink-0 tabular-nums text-slate">{k.stuks} stuks</span>
              </li>
            ))}
          </ul>
        </Kaart>
      )}
    </div>
  );
}
