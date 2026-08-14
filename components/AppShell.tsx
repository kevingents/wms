"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";
import { OutboxBalk } from "@/components/OutboxBalk";
import { cn } from "@/lib/cn";

/**
 * Schil om elke pagina. Navigatie staat onderaan op klein scherm (duimbereik op
 * een scanner) en links op groot scherm.
 */

/* Op de handterminal is /terminal het startscherm; op een bureaublad /. Beide
   staan in het menu zodat je er altijd uit kunt. */
const MENU: { pad: string; label: string; icon: IconName }[] = [
  { pad: "/terminal", label: "Terminal", icon: "terminal" },
  { pad: "/rondes", label: "Rondes", icon: "kar" },
  { pad: "/picken", label: "Picken", icon: "pick" },
  { pad: "/inslag", label: "Inslag", icon: "inslag" },
  { pad: "/scan", label: "Scannen", icon: "scan" },
  { pad: "/voorraad", label: "Voorraad", icon: "box" },
  { pad: "/tellen", label: "Tellen", icon: "tellen" },
  { pad: "/", label: "Overzicht", icon: "dashboard" },
  { pad: "/locaties", label: "Locaties", icon: "locatie" },
  { pad: "/shadow", label: "SRS-check", icon: "synchroniseer" },
];

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
      <nav
        className={cn(
          "z-20 border-navy-700 bg-navy text-white",
          "fixed inset-x-0 bottom-0 flex justify-around border-t",
          "sm:static sm:w-56 sm:flex-col sm:justify-start sm:border-r sm:border-t-0 sm:p-3"
        )}
      >
        <div className="hidden px-2 pb-4 pt-2 sm:block">
          <div className="text-sm font-bold uppercase tracking-widest">GENTS WMS</div>
          <div className="mt-0.5 text-xs text-white/60">{magazijn}</div>
        </div>

        {MENU.map((m, i) => {
          const actief = m.pad === "/" ? pad === "/" : pad.startsWith(m.pad);
          return (
            <Link
              key={m.pad}
              href={m.pad}
              aria-current={actief ? "page" : undefined}
              className={cn(
                "flex min-h-tap flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                "sm:flex-none sm:flex-row sm:justify-start sm:gap-3 sm:rounded-lg sm:px-3 sm:text-sm",
                /* De onderbalk van een handterminal heeft plek voor vijf tegels;
                   de rest bereik je via het startscherm. Op een bureaublad past
                   het hele menu wel in de zijbalk. */
                i >= 5 && "hidden sm:flex",
                actief ? "bg-navy-600 text-white" : "text-white/70 hover:text-white"
              )}
            >
              <Icon name={m.icon} size={22} />
              <span>{m.label}</span>
            </Link>
          );
        })}

        <div className="hidden sm:mt-auto sm:block sm:border-t sm:border-white/10 sm:pt-3">
          <Link
            href="/instellingen"
            className={cn(
              "flex min-h-tap items-center gap-3 rounded-lg px-3 text-sm font-medium",
              pad.startsWith("/instellingen")
                ? "bg-navy-600 text-white"
                : "text-white/70 hover:text-white"
            )}
          >
            <Icon name="instellingen" size={20} />
            Instellingen
          </Link>
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

      <div className="flex-1 pb-20 sm:pb-0">
        <OutboxBalk />
        <main className="mx-auto w-full max-w-5xl p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
