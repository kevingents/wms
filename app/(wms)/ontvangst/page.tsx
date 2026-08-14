import Link from "next/link";
import { openOntvangsten } from "@/lib/ontvangst";
import { Kaart, LeegState } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import { NieuweOntvangst } from "@/components/NieuweOntvangst";

export const dynamic = "force-dynamic";

const BRON_LABEL: Record<string, string> = {
  inkoop: "Inkooporder",
  leverancier: "Leverancier",
  winkel: "Vanuit winkel",
  retour: "Retour",
  handmatig: "Handmatig",
};

export default async function OntvangstPagina() {
  const ontvangsten = await openOntvangsten();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-navy">Ontvangst</h1>
        <p className="text-sm text-slate">
          Goederen het magazijn in, geteld tegen de verwachting.
        </p>
      </header>

      <NieuweOntvangst />

      <Kaart titel={`Openstaand (${ontvangsten.length})`}>
        {ontvangsten.length === 0 ? (
          <LeegState tekst="Geen leveringen open. Meld er een aan zodra de vrachtwagen voorrijdt." />
        ) : (
          <ul className="divide-y divide-navy-100">
            {ontvangsten.map((o) => (
              <li key={o.id}>
                <Link href={`/ontvangst/${o.id}`} className="flex items-center gap-3 py-3">
                  <span
                    className={`w-1.5 self-stretch rounded-full ${
                      o.status === "bezig" ? "bg-warn" : "bg-navy-100"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{o.code}</span>
                      <span className="rounded bg-navy-50 px-2 py-0.5 text-xs">
                        {BRON_LABEL[o.bron] ?? o.bron}
                      </span>
                      {o.afwijkingen > 0 && (
                        <span className="rounded bg-warn-100 px-2 py-0.5 text-xs text-warn">
                          {o.afwijkingen} afwijking{o.afwijkingen === 1 ? "" : "en"}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-slate">
                      {o.leverancier || "geen leverancier"} · {o.verwacht_stuks} stuks
                      verwacht over {o.regels} regel{o.regels === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-semibold tabular-nums">
                      {o.regels - o.open_regels}/{o.regels}
                    </span>
                    <span className="block text-xs text-slate">gedaan</span>
                  </span>
                  <Icon name="pijl" size={18} className="shrink-0 text-slate" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Kaart>
    </div>
  );
}
