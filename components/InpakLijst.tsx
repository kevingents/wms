"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Kaart, Knop, Melding, LeegState } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import type { Zending } from "@/lib/inpakken";
import type { PickOpdracht } from "@/lib/picken";

/**
 * De inpakwachtrij: dozen die klaarstaan, plus de gepikte opdrachten waar nog
 * geen doos voor is. Die tweede lijst is de belangrijkste — daar staat werk dat
 * anders blijft liggen omdat niemand ziet dat het klaar is om ingepakt te worden.
 */
export function InpakLijst({
  zendingen,
  gepikt,
}: {
  zendingen: Zending[];
  gepikt: PickOpdracht[];
}) {
  const router = useRouter();
  const [bezig, setBezig] = useState<number | null>(null);
  const [fout, setFout] = useState("");

  async function maakZending(pickOrderId: number) {
    setBezig(pickOrderId);
    setFout("");
    try {
      const res = await fetch("/api/zendingen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actie: "nieuw", pickOrderId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Inpakopdracht maken mislukt.");
        return;
      }
      router.push(`/inpakken/${data.zending.id}`);
      router.refresh();
    } catch {
      setFout("Geen verbinding met de server.");
    } finally {
      setBezig(null);
    }
  }

  return (
    <div className="space-y-4">
      {fout && <Melding soort="bad">{fout}</Melding>}

      <Kaart titel={`Aan de paktafel (${zendingen.length})`}>
        {zendingen.length === 0 ? (
          <LeegState tekst="Geen dozen onderhanden." />
        ) : (
          <ul className="divide-y divide-navy-100">
            {zendingen.map((z) => (
              <li key={z.id}>
                <Link href={`/inpakken/${z.id}`} className="flex items-center gap-3 py-3">
                  <span
                    className={`w-1.5 self-stretch rounded-full ${
                      z.status === "ingepakt" ? "bg-ok" : "bg-navy-100"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{z.code}</span>
                      {z.status === "ingepakt" && (
                        <span className="rounded bg-ok-100 px-2 py-0.5 text-xs text-ok">
                          klaar om te verzenden
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-slate">
                      {z.bestemming || "geen bestemming"} · {z.stuks} stuks
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-semibold tabular-nums">
                      {z.gecontroleerd}/{z.regels}
                    </span>
                    <span className="block text-xs text-slate">gescand</span>
                  </span>
                  <Icon name="pijl" size={18} className="shrink-0 text-slate" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Kaart>

      <Kaart titel={`Gepikt, wacht op een doos (${gepikt.length})`}>
        {gepikt.length === 0 ? (
          <LeegState tekst="Niets staat te wachten. Pik eerst een ronde." />
        ) : (
          <ul className="divide-y divide-navy-100">
            {gepikt.map((o) => (
              <li key={o.id} className="flex items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-sm font-semibold">{o.code}</span>
                  <span className="mt-0.5 block truncate text-sm text-slate">
                    {o.bestemming || "geen bestemming"} · {o.stuks} stuks
                  </span>
                </span>
                <Knop
                  variant="secundair"
                  onClick={() => maakZending(o.id)}
                  disabled={bezig === o.id}
                >
                  <Icon name="box" size={16} />
                  {bezig === o.id ? "Bezig…" : "Inpakken"}
                </Knop>
              </li>
            ))}
          </ul>
        )}
      </Kaart>
    </div>
  );
}
