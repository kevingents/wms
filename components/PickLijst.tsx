"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Kaart, Knop, Melding, LeegState } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { PickOpdracht } from "@/lib/picken";

/**
 * De werkvoorraad. Bewust één lijst en geen tabs: een picker moet bovenaan
 * kunnen beginnen zonder te kiezen. Weborders staan boven transfers doordat ze
 * een hogere prioriteit meekrijgen bij de import.
 */

const BRON_LABEL: Record<string, string> = {
  weborder: "Weborder",
  transfer: "Naar winkel",
  handmatig: "Handmatig",
};

function duur(vanaf: string | null) {
  if (!vanaf) return null;
  const minuten = Math.round((Date.now() - new Date(vanaf).getTime()) / 60000);
  if (minuten < 1) return "net gestart";
  if (minuten < 60) return `${minuten} min bezig`;
  return `${Math.floor(minuten / 60)} u bezig`;
}

export function PickLijst({ opdrachten }: { opdrachten: PickOpdracht[] }) {
  const router = useRouter();
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState("");
  const [fout, setFout] = useState("");

  async function importeren() {
    setBezig(true);
    setFout("");
    setMelding("");
    try {
      const res = await fetch("/api/picken", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actie: "import" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Importeren mislukt.");
        return;
      }
      setMelding(
        data.nieuw === 0
          ? "Geen nieuw pickwerk gevonden."
          : `${data.nieuw} nieuwe opdracht${data.nieuw === 1 ? "" : "en"} met ${data.regels} regels.` +
              (data.zonderVoorraad > 0
                ? ` Let op: ${data.zonderVoorraad} regel(s) zonder voorraad in het magazijn.`
                : "")
      );
      router.refresh();
    } catch {
      setFout("Geen verbinding met de server.");
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="space-y-4">
      {melding && <Melding soort="ok">{melding}</Melding>}
      {fout && <Melding soort="bad">{fout}</Melding>}

      <Kaart
        titel="Werkvoorraad"
        actie={
          <Knop variant="secundair" onClick={importeren} disabled={bezig}>
            <Icon name="synchroniseer" size={16} />
            {bezig ? "Bezig…" : "Nieuw werk ophalen"}
          </Knop>
        }
      >
        {opdrachten.length === 0 ? (
          <LeegState tekst="Geen openstaande pickopdrachten. Haal nieuw werk op uit de webshop en de transfers." />
        ) : (
          <ul className="divide-y divide-navy-100">
            {opdrachten.map((o) => {
              const gedaan = o.regels - o.open_regels;
              return (
                <li key={o.id}>
                  <Link
                    href={`/picken/${o.id}`}
                    className="flex items-center gap-3 py-3 text-left"
                  >
                    <span
                      className={cn(
                        "w-1.5 self-stretch rounded-full",
                        o.status === "bezig" ? "bg-warn" : "bg-navy-100"
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{o.code}</span>
                        <span className="rounded bg-navy-50 px-2 py-0.5 text-xs">
                          {BRON_LABEL[o.bron] ?? o.bron}
                        </span>
                        {o.status === "bezig" && (
                          <span className="rounded bg-warn-100 px-2 py-0.5 text-xs text-warn">
                            {o.toegewezen_naam ?? "bezig"}
                          </span>
                        )}
                        {/* Niet leverbaar vóór het lopen zichtbaar maken: anders
                            valt de picker halverwege stil bij een regel zonder
                            locatie, en dat kost een hele ronde. */}
                        {o.zonder_locatie > 0 && (
                          <span className="rounded bg-bad-100 px-2 py-0.5 text-xs text-bad">
                            {o.zonder_locatie === o.open_regels
                              ? "geen voorraad"
                              : `${o.zonder_locatie} regel(s) zonder voorraad`}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-slate">
                        {o.bestemming || "geen bestemming"} · {o.stuks} stuks over{" "}
                        {o.regels} regel{o.regels === 1 ? "" : "s"}
                        {o.status === "bezig" && duur(o.started_at)
                          ? ` · ${duur(o.started_at)}`
                          : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold tabular-nums">
                        {gedaan}/{o.regels}
                      </span>
                      <span className="block text-xs text-slate">gedaan</span>
                    </span>
                    <Icon name="pijl" size={18} className="shrink-0 text-slate" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Kaart>
    </div>
  );
}
