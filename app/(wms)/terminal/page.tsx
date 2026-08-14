import Link from "next/link";
import { kerncijfers } from "@/lib/voorraad";
import { werkvoorraad } from "@/lib/picken";
import { indeelVoortgang } from "@/lib/inslag";
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
  { pad: "/picken", label: "Picken", icon: "pick", omschrijving: "Orders uitleveren" },
  { pad: "/inslag", label: "Inslag", icon: "inslag", omschrijving: "Voorraad inboeken" },
  { pad: "/scan", label: "Verplaatsen", icon: "scan", omschrijving: "Tussen vakken" },
  { pad: "/tellen", label: "Tellen", icon: "tellen", omschrijving: "Locatie controleren" },
  { pad: "/voorraad", label: "Zoeken", icon: "zoek", omschrijving: "Waar ligt het?" },
  { pad: "/locaties", label: "Locaties", icon: "locatie", omschrijving: "Vakken beheren" },
];

export default async function TerminalPagina() {
  const [cijfers, opdrachten, voortgang, user] = await Promise.all([
    kerncijfers(),
    werkvoorraad(),
    indeelVoortgang(),
    huidigeGebruiker(),
  ]);

  const tellers: Record<string, string | null> = {
    "/picken": opdrachten.length > 0 ? String(opdrachten.length) : null,
    "/inslag":
      voortgang.wachtend_stuks > 0
        ? voortgang.wachtend_stuks.toLocaleString("nl-NL")
        : null,
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
