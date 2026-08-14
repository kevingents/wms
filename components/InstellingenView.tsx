"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Kaart, Knop, Melding, invoerClasses } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import type { InstellingDefinitie } from "@/lib/instellingen";

/**
 * Instellingen. Alles wat het magazijn zelf moet kunnen aanpassen staat hier —
 * niet in Vercel. Alleen secrets (databasesleutel, sessie-secret, admin-token)
 * blijven env-vars.
 *
 * Eén kaart per groep, met een knop die de bewerkmodus opent. Een nieuwe
 * instelling toevoegen is één regel in lib/instellingen.ts; dit scherm bouwt
 * zichzelf uit die definities.
 */
export function InstellingenView({
  definities,
  waarden,
  magBeheren,
}: {
  definities: InstellingDefinitie[];
  waarden: Record<string, unknown>;
  magBeheren: boolean;
}) {
  const router = useRouter();
  const [bewerkt, setBewerkt] = useState<Record<string, unknown>>({});
  const [openGroep, setOpenGroep] = useState<string | null>(null);
  const [melding, setMelding] = useState("");
  const [fout, setFout] = useState("");
  const [bezig, setBezig] = useState(false);

  const groepen = [...new Set(definities.map((d) => d.groep))];
  const huidig = (key: string) => (key in bewerkt ? bewerkt[key] : waarden[key]);

  async function opslaan(groep: string) {
    const keys = definities.filter((d) => d.groep === groep).map((d) => d.key);
    const wijzigingen = Object.fromEntries(
      keys.filter((k) => k in bewerkt).map((k) => [k, bewerkt[k]])
    );
    if (Object.keys(wijzigingen).length === 0) {
      setOpenGroep(null);
      return;
    }

    setBezig(true);
    setFout("");
    setMelding("");
    try {
      const res = await fetch("/api/instellingen", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wijzigingen }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Opslaan mislukt.");
        return;
      }
      setMelding(`${groep} opgeslagen.`);
      setBewerkt((b) => {
        const rest = { ...b };
        for (const k of keys) delete rest[k];
        return rest;
      });
      setOpenGroep(null);
      router.refresh();
    } catch {
      setFout("Geen verbinding met de server.");
    } finally {
      setBezig(false);
    }
  }

  function veld(d: InstellingDefinitie) {
    const waarde = huidig(d.key);
    const zet = (v: unknown) => setBewerkt((b) => ({ ...b, [d.key]: v }));

    if (d.type === "schakelaar") {
      return (
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(waarde)}
          onClick={() => zet(!waarde)}
          className={`inline-flex h-8 w-14 items-center rounded-full transition-colors ${
            waarde ? "bg-ok" : "bg-navy-100"
          }`}
        >
          <span
            className={`h-6 w-6 rounded-full bg-white shadow transition-transform ${
              waarde ? "translate-x-7" : "translate-x-1"
            }`}
          />
        </button>
      );
    }

    if (d.type === "getal") {
      return (
        <input
          type="number"
          className={`${invoerClasses} max-w-32`}
          value={String(waarde ?? "")}
          onChange={(e) => zet(e.target.value === "" ? 0 : Number(e.target.value))}
        />
      );
    }

    if (d.type === "lijst") {
      const lijst = Array.isArray(waarde) ? (waarde as string[]) : [];
      return (
        <input
          className={invoerClasses}
          value={lijst.join(", ")}
          onChange={(e) =>
            zet(
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            )
          }
        />
      );
    }

    return (
      <input
        className={invoerClasses}
        value={String(waarde ?? "")}
        onChange={(e) => zet(e.target.value)}
      />
    );
  }

  function toon(d: InstellingDefinitie) {
    const waarde = huidig(d.key);
    if (d.type === "schakelaar") return waarde ? "Aan" : "Uit";
    if (d.type === "lijst") return Array.isArray(waarde) ? waarde.join(", ") : "—";
    return String(waarde ?? "—") || "—";
  }

  return (
    <div className="space-y-4">
      {melding && <Melding soort="ok">{melding}</Melding>}
      {fout && <Melding soort="bad">{fout}</Melding>}
      {!magBeheren && (
        <Melding soort="info">
          Je kunt de instellingen bekijken maar niet wijzigen. Vraag een teamleider.
        </Melding>
      )}

      {groepen.map((groep) => {
        const open = openGroep === groep;
        const items = definities.filter((d) => d.groep === groep);
        return (
          <Kaart
            key={groep}
            titel={groep}
            actie={
              magBeheren && (
                <Knop
                  variant="secundair"
                  onClick={() => setOpenGroep(open ? null : groep)}
                >
                  <Icon name={open ? "kruis" : "instellingen"} size={16} />
                  {open ? "Annuleren" : "Wijzigen"}
                </Knop>
              )
            }
          >
            <dl className="divide-y divide-navy-100">
              {items.map((d) => (
                <div key={d.key} className="py-3 sm:flex sm:items-start sm:gap-4">
                  <div className="sm:flex-1">
                    <dt className="text-sm font-medium text-navy">{d.label}</dt>
                    <dd className="mt-0.5 text-xs text-slate">{d.uitleg}</dd>
                  </div>
                  <div className="mt-2 sm:mt-0 sm:w-64 sm:shrink-0">
                    {open ? (
                      veld(d)
                    ) : (
                      <span className="text-sm text-navy">{toon(d)}</span>
                    )}
                  </div>
                </div>
              ))}
            </dl>
            {open && (
              <div className="mt-3 flex gap-2">
                <Knop onClick={() => opslaan(groep)} disabled={bezig}>
                  {bezig ? "Bezig…" : "Opslaan"}
                </Knop>
              </div>
            )}
          </Kaart>
        );
      })}
    </div>
  );
}
