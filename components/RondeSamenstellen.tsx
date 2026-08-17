"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Kaart, Knop, Melding, LeegState } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { PickOpdracht } from "@/lib/picken";
import type { Ronde } from "@/lib/rondes";

/**
 * Ronde samenstellen: orders aanvinken, één bak per order.
 *
 * De volgorde waarin je aanvinkt is de baknummering — dat is bewust, want de
 * picker zet de bakken in die volgorde op de kar. Bak 1 is de eerst aangevinkte
 * order.
 */

const BRON_LABEL: Record<string, string> = {
  weborder: "Weborder",
  transfer: "Naar winkel",
  aanvulling: "Aanvulling",
  herverdeling: "Herverdeling",
  forecast: "Forecast",
  inkoop: "Inkoop",
  handmatig: "Handmatig",
};

export function RondeSamenstellen({
  rondes,
  opdrachten,
  maxBakken,
}: {
  rondes: Ronde[];
  opdrachten: PickOpdracht[];
  maxBakken: number;
}) {
  const router = useRouter();
  const [gekozen, setGekozen] = useState<number[]>([]);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState("");

  /* Opdrachten die al in een ronde zitten tonen we niet: die liggen al op een
     kar en zouden anders dubbel gelopen worden. */
  const vrij = opdrachten.filter((o) => o.status === "open");

  function wissel(id: number) {
    setFout("");
    setGekozen((g) =>
      g.includes(id) ? g.filter((x) => x !== id) : g.length >= maxBakken ? g : [...g, id]
    );
  }

  async function maken() {
    if (gekozen.length === 0) return;
    setBezig(true);
    setFout("");
    try {
      const res = await fetch("/api/rondes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pickOrderIds: gekozen }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Ronde aanmaken mislukt.");
        return;
      }
      router.push(`/rondes/${data.ronde.id}`);
      router.refresh();
    } catch {
      setFout("Geen verbinding met de server.");
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="space-y-4">
      {fout && <Melding soort="bad">{fout}</Melding>}

      {rondes.length > 0 && (
        <Kaart titel="Lopende rondes">
          <ul className="divide-y divide-navy-100">
            {rondes.map((r) => (
              <li key={r.id}>
                <Link href={`/rondes/${r.id}`} className="flex items-center gap-3 py-3">
                  <span
                    className={cn(
                      "w-1.5 self-stretch rounded-full",
                      r.status === "bezig" ? "bg-warn" : "bg-navy-100"
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-sm font-semibold">{r.code}</span>
                    <span className="mt-0.5 block text-sm text-slate">
                      {r.bakken} bakken · {r.stops} stops · {r.stuks} stuks
                      {r.gestart_naam ? ` · ${r.gestart_naam}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-semibold tabular-nums">
                      {r.regels - r.open_regels}/{r.regels}
                    </span>
                    <span className="block text-xs text-slate">regels</span>
                  </span>
                  <Icon name="pijl" size={18} className="shrink-0 text-slate" />
                </Link>
              </li>
            ))}
          </ul>
        </Kaart>
      )}

      <Kaart
        titel={`Ronde samenstellen (${gekozen.length}/${maxBakken} bakken)`}
        actie={
          gekozen.length > 0 && (
            <Knop onClick={maken} disabled={bezig}>
              <Icon name="pick" size={16} />
              {bezig ? "Bezig…" : "Ronde starten"}
            </Knop>
          )
        }
      >
        <p className="mb-3 text-sm text-slate">
          Vink de orders aan die je in één ronde meeneemt. De volgorde van aanvinken is
          de baknummering — zet de bakken in die volgorde op je kar.
        </p>

        {vrij.length === 0 ? (
          <LeegState tekst="Geen vrije opdrachten. Haal eerst nieuw werk op bij Picken." />
        ) : (
          <ul className="divide-y divide-navy-100">
            {vrij.map((o) => {
              const index = gekozen.indexOf(o.id);
              const aan = index >= 0;
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => wissel(o.id)}
                    className="flex w-full items-center gap-3 py-3 text-left"
                  >
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 text-sm font-bold",
                        aan
                          ? "border-navy bg-navy text-white"
                          : "border-navy-100 text-slate"
                      )}
                    >
                      {aan ? index + 1 : ""}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{o.code}</span>
                        <span className="rounded bg-navy-50 px-2 py-0.5 text-xs">
                          {BRON_LABEL[o.bron] ?? o.bron}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-slate">
                        {o.bestemming || "geen bestemming"} · {o.stuks} stuks over{" "}
                        {o.regels} regel{o.regels === 1 ? "" : "s"}
                      </span>
                      {/* Een order die niet gelopen kan worden hoort niet in een
                          ronde: dan staat er een bak op de kar die leeg blijft. */}
                      {o.zonder_locatie > 0 && (
                        <span className="mt-0.5 block text-xs font-medium text-bad">
                          {o.zonder_locatie === o.open_regels
                            ? "geen voorraad toegewezen — niet te lopen"
                            : `${o.zonder_locatie} van ${o.open_regels} regels zonder voorraad`}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {gekozen.length >= maxBakken && (
          <Melding soort="info">
            De kar is vol ({maxBakken} bakken). Start deze ronde en maak daarna een
            volgende.
          </Melding>
        )}
      </Kaart>
    </div>
  );
}
