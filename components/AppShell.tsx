"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";
import { OutboxBalk } from "@/components/OutboxBalk";
import { cn } from "@/lib/cn";

/**
 * Schil om elke pagina.
 *
 * WAAROM GROEPEN EN GEEN PLATTE LIJST
 * -----------------------------------
 * Er zijn eenentwintig schermen. Een platte lijst daarvan is een lijst die je
 * moet lézen om iets te vinden, en dat doe je in een magazijn niet — dan onthoud
 * je gewoon de derde van boven en dat gaat mis zodra er iets bijkomt.
 *
 * De groepen volgen wat iemand aan het doen is, niet hoe het systeem in elkaar
 * zit: goederen die eruit gaan, goederen die erin komen, de voorraad zelf,
 * sturing. Dat is de indeling die een magazijnmedewerker al in z'n hoofd heeft.
 *
 * WAAROM DE ONDERBALK VAST IS
 * ---------------------------
 * Op een handterminal past er vijf in de duimzone. Die vijf staan hier
 * expliciet en zijn niet "de eerste vijf van de lijst" — anders verschuift de
 * balk zodra er een scherm bijkomt, en spiergeheugen is precies wat je op een
 * scanner wél wil hebben. Al het overige gaat via het startscherm of de zijbalk.
 */

interface Item {
  pad: string;
  label: string;
  icon: IconName;
}

/** De vijf in de duimzone van een handterminal. Wijzig dit niet lichtvaardig. */
const ONDERBALK: Item[] = [
  { pad: "/terminal", label: "Start", icon: "terminal" },
  { pad: "/rondes", label: "Rondes", icon: "kar" },
  { pad: "/inpakken", label: "Inpakken", icon: "box" },
  { pad: "/taken", label: "Taken", icon: "taken" },
  { pad: "/scan", label: "Scannen", icon: "scan" },
];

const GROEPEN: { titel: string; items: Item[] }[] = [
  {
    titel: "Eruit",
    items: [
      { pad: "/rondes", label: "Pickrondes", icon: "kar" },
      { pad: "/picken", label: "Losse orders", icon: "pick" },
      { pad: "/aanvullen", label: "Winkelaanvulling", icon: "winkel" },
      { pad: "/inpakken", label: "Inpakken", icon: "box" },
    ],
  },
  {
    titel: "Erin",
    items: [
      { pad: "/ontvangst", label: "Ontvangst", icon: "inslag" },
      { pad: "/inslag", label: "Inslag", icon: "inslag" },
      { pad: "/colli", label: "Colli", icon: "collo" },
      { pad: "/retouren", label: "Retouren", icon: "retour" },
    ],
  },
  {
    titel: "Voorraad",
    items: [
      { pad: "/voorraad", label: "Opzoeken", icon: "zoek" },
      { pad: "/scan", label: "Verplaatsen", icon: "scan" },
      { pad: "/tellen", label: "Tellen", icon: "tellen" },
      { pad: "/taken", label: "Taken", icon: "taken" },
      { pad: "/locaties", label: "Locaties", icon: "locatie" },
      { pad: "/labels", label: "Labels", icon: "label" },
    ],
  },
  {
    titel: "Sturing",
    items: [
      { pad: "/", label: "Overzicht", icon: "dashboard" },
      { pad: "/signalen", label: "Signalen", icon: "alert" },
      { pad: "/kpi", label: "Cijfers", icon: "grafiek" },
      { pad: "/financieel", label: "Financieel", icon: "euro" },
      { pad: "/shadow", label: "SRS-check", icon: "synchroniseer" },
    ],
  },
];

function isActief(pad: string, huidig: string): boolean {
  return pad === "/" ? huidig === "/" : huidig === pad || huidig.startsWith(`${pad}/`);
}

export function AppShell({
  gebruiker,
  magazijn,
  children,
}: {
  gebruiker: string;
  magazijn: string;
  children: React.ReactNode;
}) {
  const pad = usePathname();

  return (
    <div className="min-h-screen sm:flex">
      {/* ── Zijbalk op groot scherm ──────────────────────────────────────── */}
      <nav
        className={cn(
          "z-20 hidden border-navy-700 bg-navy text-white",
          "sm:flex sm:w-56 sm:shrink-0 sm:flex-col sm:border-r sm:p-3"
        )}
        aria-label="Hoofdmenu"
      >
        <Link href="/terminal" className="block px-2 pb-4 pt-2">
          <span className="block text-sm font-bold uppercase tracking-widest">
            GENTS WMS
          </span>
          <span className="mt-0.5 block text-xs text-white/60">{magazijn}</span>
        </Link>

        <div className="flex-1 space-y-4 overflow-y-auto">
          {GROEPEN.map((groep) => (
            <div key={groep.titel}>
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-white/40">
                {groep.titel}
              </div>
              {groep.items.map((m) => (
                <Link
                  key={`${groep.titel}-${m.pad}`}
                  href={m.pad}
                  aria-current={isActief(m.pad, pad) ? "page" : undefined}
                  className={cn(
                    "flex min-h-tap items-center gap-3 rounded-lg px-3 text-sm font-medium",
                    isActief(m.pad, pad)
                      ? "bg-navy-600 text-white"
                      : "text-white/70 hover:text-white"
                  )}
                >
                  <Icon name={m.icon} size={20} />
                  {m.label}
                </Link>
              ))}
            </div>
          ))}
        </div>

        <div className="mt-4 border-t border-white/10 pt-3">
          {[
            { pad: "/help", label: "Handleiding", icon: "help" as IconName },
            { pad: "/gebruikers", label: "Gebruikers", icon: "users" as IconName },
            { pad: "/instellingen", label: "Instellingen", icon: "instellingen" as IconName },
          ].map((m) => (
            <Link
              key={m.pad}
              href={m.pad}
              className={cn(
                "flex min-h-tap items-center gap-3 rounded-lg px-3 text-sm font-medium",
                isActief(m.pad, pad)
                  ? "bg-navy-600 text-white"
                  : "text-white/70 hover:text-white"
              )}
            >
              <Icon name={m.icon} size={20} />
              {m.label}
            </Link>
          ))}
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="flex min-h-tap w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-white/70 hover:text-white"
            >
              <Icon name="uitloggen" size={20} />
              <span className="truncate">{gebruiker}</span>
            </button>
          </form>
        </div>
      </nav>

      {/* ── Onderbalk op de handterminal ─────────────────────────────────── */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-navy-700 bg-navy text-white sm:hidden"
        aria-label="Hoofdmenu"
      >
        {ONDERBALK.map((m) => (
          <Link
            key={m.pad}
            href={m.pad}
            aria-current={isActief(m.pad, pad) ? "page" : undefined}
            className={cn(
              "flex min-h-tap flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
              isActief(m.pad, pad) ? "bg-navy-600 text-white" : "text-white/70"
            )}
          >
            <Icon name={m.icon} size={22} />
            <span>{m.label}</span>
          </Link>
        ))}
      </nav>

      <div className="flex-1 pb-20 sm:pb-0">
        <OutboxBalk />
        <main className="mx-auto w-full max-w-5xl p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
