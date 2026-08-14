import Link from "next/link";
import { kerncijfers } from "@/lib/voorraad";
import { werkvoorraad } from "@/lib/picken";
import { openRondes } from "@/lib/rondes";
import { werkstand } from "@/lib/kpi";
import { huidigeGebruiker } from "@/lib/auth-server";
import { Icon, type IconName } from "@/components/ui/Icon";

export const dynamic = "force-dynamic";

/**
 * Startscherm van de handterminal.
 *
 * Dit is de `start_url` van de PWA en bewust géén dashboard: op een scherm van
 * vijf inch, met handschoenen aan, wil je vier grote tegels en een teller — geen
 * tabellen. De cijfers op de tegels zijn het enige wat een magazijnmedewerker
 * bij het oppakken van de terminal wil weten: hoeveel werk ligt er.
 */

const TEGELS: {
  pad: string;
  label: string;
  icon: IconName;
  omschrijving: string;
}[] = [
  { pad: "/rondes", label: "Rondes", icon: "kar", omschrijving: "Batch met bakken" },
  { pad: "/inpakken", label: "Inpakken", icon: "box", omschrijving: "Doos dicht" },
  { pad: "/ontvangst", label: "Ontvangst", icon: "inslag", omschrijving: "Levering uitpakken" },
  { pad: "/retouren", label: "Retouren", icon: "retour", omschrijving: "Aannemen, beoordelen" },
  { pad: "/taken", label: "Taken", icon: "taken", omschrijving: "Aanvullen, tellen" },
  { pad: "/scan", label: "Verplaatsen", icon: "scan", omschrijving: "Tussen vakken" },
  { pad: "/voorraad", label: "Zoeken", icon: "zoek", omschrijving: "Waar ligt het?" },
  { pad: "/picken", label: "Losse pick", icon: "pick", omschrijving: "Eén order" },
];

export default async function TerminalPagina() {
  const [cijfers, opdrachten, rondes, stand, user] = await Promise.all([
    kerncijfers(),
    werkvoorraad(),
    openRondes(),
    werkstand(),
    huidigeGebruiker(),
  ]);

  /* Alleen tellen wat er écht ligt te wachten — een tegel met een 0 erop leidt
     alleen maar af. */
  const teller = (n: number) => (n > 0 ? String(n) : null);

  const tellers: Record<string, string | null> = {
    "/rondes": teller(rondes.length),
    "/inpakken": teller(stand.zending_open),
    "/ontvangst": teller(stand.ontvangst_open),
    "/retouren": teller(stand.retour_open),
    "/taken": teller(stand.taken_open),
    "/picken": teller(opdrachten.length),
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-navy">Hallo {user?.name?.split(" ")[0]}</h1>
        <p className="text-sm text-slate">
          {cijfers.stuks.toLocaleString("nl-NL")} stuks op {cijfers.bezette_locaties} van{" "}
          {cijfers.locaties} locaties · {cijfers.boekingen_vandaag} boekingen vandaag
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        {TEGELS.map((t) => (
          <Link
            key={t.pad}
            href={t.pad}
            className="relative flex min-h-32 flex-col justify-between rounded-xl border border-navy-100 bg-white p-4 shadow-card active:bg-navy-50"
          >
            {tellers[t.pad] && (
              <span className="absolute right-3 top-3 rounded-full bg-navy px-2 py-0.5 text-xs font-bold tabular-nums text-white">
                {tellers[t.pad]}
              </span>
            )}
            <Icon name={t.icon} size={30} className="text-navy" />
            <div>
              <div className="text-base font-semibold text-navy">{t.label}</div>
              <div className="text-xs text-slate">{t.omschrijving}</div>
            </div>
          </Link>
        ))}
      </div>

      <form action="/api/auth/logout" method="post">
        <button
          type="submit"
          className="flex min-h-tap w-full items-center justify-center gap-2 rounded-lg border border-navy-100 bg-white text-sm font-medium text-slate"
        >
          <Icon name="uitloggen" size={18} />
          Uitloggen
        </button>
      </form>
    </div>
  );
}
