"use client";

import { useEffect, useState } from "react";
import { Kaart, Knop, Melding, LeegState } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { Gebruiker } from "@/lib/toegang";
import type { WmsRol } from "@/lib/session";

/**
 * Gebruikers en rechten.
 *
 * Medewerkers verschijnen hier vanzelf zodra ze een keer inloggen — er hoeft dus
 * niemand personeelsnummers over te typen, en dat is precies de stap waar zulke
 * schermen normaal op stuklopen.
 *
 * De bootstrap-waarschuwing staat bovenaan en niet onderaan: zolang die er staat
 * kan iedereen bij alles, en dat hoort geen voetnoot te zijn.
 */

interface RolDefinitie {
  waarde: WmsRol;
  label: string;
  uitleg: string;
}

export function GebruikersBeheer() {
  const [gebruikers, setGebruikers] = useState<Gebruiker[]>([]);
  const [rollen, setRollen] = useState<RolDefinitie[]>([]);
  const [bootstrap, setBootstrap] = useState(false);
  const [ikZelf, setIkZelf] = useState("");
  const [laden, setLaden] = useState(true);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState("");
  const [melding, setMelding] = useState("");

  async function laad() {
    setLaden(true);
    try {
      const res = await fetch("/api/gebruikers");
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Gebruikers ophalen mislukt.");
        return;
      }
      setGebruikers(data.gebruikers);
      setRollen(data.rollen);
      setBootstrap(data.bootstrap);
      setIkZelf(data.ikZelf);
    } catch {
      setFout("Geen verbinding met de server.");
    } finally {
      setLaden(false);
    }
  }

  useEffect(() => {
    void laad();
  }, []);

  async function actie(body: Record<string, unknown>) {
    setBezig(true);
    setFout("");
    setMelding("");
    try {
      const res = await fetch("/api/gebruikers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Wijziging mislukt.");
        return false;
      }
      await laad();
      return true;
    } catch {
      setFout("Geen verbinding met de server.");
      return false;
    } finally {
      setBezig(false);
    }
  }

  async function wijzigRol(g: Gebruiker, rol: WmsRol) {
    if (rol === g.rol) return;
    /* Jezelf degraderen is toegestaan maar zelden bedoeld. */
    if (g.personnel_id === ikZelf && rol !== "beheer") {
      const akkoord = window.confirm(
        "Je wijzigt je eigen rol naar iets met minder rechten. Weet je het zeker?"
      );
      if (!akkoord) return;
    }
    if (await actie({ actie: "rol", personnelId: g.personnel_id, rol })) {
      setMelding(`${g.naam || g.personnel_id} is nu ${rol}.`);
    }
  }

  async function wisselActief(g: Gebruiker) {
    const ok = await actie({
      actie: g.actief ? "deactiveer" : "activeer",
      personnelId: g.personnel_id,
    });
    if (ok) {
      setMelding(
        g.actief
          ? `${g.naam || g.personnel_id} heeft geen rechten meer.`
          : `${g.naam || g.personnel_id} kan weer werken.`
      );
    }
  }

  function datum(iso: string | null) {
    if (!iso) return "nooit";
    return new Date(iso).toLocaleString("nl-NL", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Amsterdam",
    });
  }

  if (laden) {
    return (
      <Kaart>
        <p className="text-sm text-slate">Gebruikers laden…</p>
      </Kaart>
    );
  }

  const actieveBeheerders = gebruikers.filter((g) => g.actief && g.rol === "beheer").length;

  return (
    <div className="space-y-4">
      {bootstrap && (
        <Melding soort="bad">
          <span className="block font-semibold">Iedereen heeft nu beheerrechten.</span>
          Er staat nog niemand in deze lijst, dus krijgt elke medewerker die inlogt alle
          rechten — inclusief instellingen, afschrijven en de boekhouding. Wijs jezelf
          hieronder aan als beheerder; vanaf dat moment geldt de lijst.
        </Melding>
      )}

      {melding && <Melding soort="ok">{melding}</Melding>}
      {fout && <Melding soort="bad">{fout}</Melding>}

      <Kaart titel={`Medewerkers (${gebruikers.length})`}>
        {gebruikers.length === 0 ? (
          <LeegState tekst="Nog niemand ingelogd. Medewerkers verschijnen hier vanzelf zodra ze de eerste keer inloggen." />
        ) : (
          <ul className="divide-y divide-navy-100">
            {gebruikers.map((g) => (
              <li key={g.personnel_id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-navy">
                        {g.naam || g.personnel_id}
                      </span>
                      <span className="font-mono text-xs text-slate">
                        {g.personnel_id}
                      </span>
                      {g.personnel_id === ikZelf && (
                        <span className="rounded bg-navy-50 px-2 py-0.5 text-xs">jij</span>
                      )}
                      {!g.actief && (
                        <span className="rounded bg-bad-100 px-2 py-0.5 text-xs text-bad">
                          geen rechten
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-slate">
                      laatst ingelogd {datum(g.laatste_login)}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => wisselActief(g)}
                    disabled={bezig}
                    className="shrink-0 text-xs text-slate underline underline-offset-2 disabled:opacity-40"
                  >
                    {g.actief ? "Rechten intrekken" : "Weer toelaten"}
                  </button>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2">
                  {rollen.map((r) => (
                    <button
                      key={r.waarde}
                      type="button"
                      onClick={() => wijzigRol(g, r.waarde)}
                      disabled={bezig || !g.actief}
                      className={cn(
                        "min-h-tap rounded-lg border-2 px-2 py-1.5 text-left disabled:opacity-40",
                        g.rol === r.waarde
                          ? "border-navy bg-navy text-white"
                          : "border-navy-100 bg-white text-navy"
                      )}
                    >
                      <span className="block text-sm font-semibold">{r.label}</span>
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Kaart>

      <Kaart titel="Wat mag welke rol?">
        <dl className="divide-y divide-navy-100">
          {rollen.map((r) => (
            <div key={r.waarde} className="py-2">
              <dt className="text-sm font-semibold text-navy">{r.label}</dt>
              <dd className="text-sm text-slate">{r.uitleg}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 rounded-lg bg-navy-50 px-3 py-2 text-sm text-slate">
          Er wordt ingelogd met het SRS-personeelsnummer en dezelfde pincode als in de
          portal. Deze lijst zegt alleen wat iemand daarna mag — er is geen tweede
          wachtwoord om te beheren.
        </p>
        {actieveBeheerders === 1 && !bootstrap && (
          <Melding soort="warn">
            Er is maar één beheerder. Valt die uit, dan kan niemand instellingen of
            rechten meer wijzigen. Wijs er een tweede aan.
          </Melding>
        )}
      </Kaart>
    </div>
  );
}
