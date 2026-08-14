"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Kaart, Knop, Melding, Veld, LeegState, invoerClasses } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import { LOCATIE_SOORTEN, type Locatie } from "@/lib/types";

/**
 * Locatiebeheer. De reeksgenerator is er omdat niemand 300 schaplocaties met de
 * hand invoert: je geeft gang, stelling en niveaus op en krijgt de codes.
 * `sort_order` wordt automatisch oplopend gezet — dat ís de looproute.
 */
export function LocatiesBeheer({
  locaties,
  magBeheren,
}: {
  locaties: Locatie[];
  magBeheren: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fout, setFout] = useState("");
  const [melding, setMelding] = useState("");
  const [bezig, setBezig] = useState(false);

  const [zone, setZone] = useState("A");
  const [gangen, setGangen] = useState("1");
  const [stellingen, setStellingen] = useState("1-6");
  const [niveaus, setNiveaus] = useState("1-4");
  const [soort, setSoort] = useState("pick");

  /** "1-6" → [1,2,3,4,5,6]; "2" → [2]; "1,3,5" → [1,3,5] */
  function reeks(invoer: string): number[] {
    const uit: number[] = [];
    for (const deel of invoer.split(",")) {
      const m = deel.trim().match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        const [van, tot] = [Number(m[1]), Number(m[2])];
        for (let i = Math.min(van, tot); i <= Math.max(van, tot); i++) uit.push(i);
      } else if (/^\d+$/.test(deel.trim())) {
        uit.push(Number(deel.trim()));
      }
    }
    return uit;
  }

  const voorbeeld = (() => {
    const g = reeks(gangen);
    const s = reeks(stellingen);
    const n = reeks(niveaus);
    const aantal = g.length * s.length * n.length;
    const eerste =
      g.length && s.length && n.length
        ? `${zone.toUpperCase()}${g[0]}-${String(s[0]).padStart(2, "0")}-${n[0]}`
        : "";
    return { aantal, eerste };
  })();

  async function aanmaken() {
    setFout("");
    setMelding("");
    const g = reeks(gangen);
    const s = reeks(stellingen);
    const n = reeks(niveaus);
    if (!zone.trim() || !g.length || !s.length || !n.length) {
      setFout("Vul zone, gangen, stellingen en niveaus in.");
      return;
    }
    if (voorbeeld.aantal > 2000) {
      setFout(`Dat zijn ${voorbeeld.aantal} locaties. Doe het in kleinere stukken.`);
      return;
    }

    setBezig(true);
    let gemaakt = 0;
    let volgorde = locaties.length * 10;
    try {
      for (const gang of g) {
        for (const stelling of s) {
          for (const niveau of n) {
            volgorde += 10;
            const code = `${zone.toUpperCase()}${gang}-${String(stelling).padStart(2, "0")}-${niveau}`;
            const res = await fetch("/api/locaties", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                code,
                zone: zone.toUpperCase(),
                soort,
                volgorde,
                naam: `Gang ${gang}, stelling ${stelling}, niveau ${niveau}`,
              }),
            });
            if (res.ok) gemaakt += 1;
            else {
              const data = await res.json().catch(() => ({}));
              setFout(data.message || `Aanmaken van ${code} mislukt.`);
              return;
            }
          }
        }
      }
      setMelding(`${gemaakt} locaties aangemaakt of bijgewerkt.`);
      setOpen(false);
      router.refresh();
    } catch {
      setFout("Geen verbinding met de server.");
    } finally {
      setBezig(false);
    }
  }

  const perZone = locaties.reduce<Record<string, Locatie[]>>((acc, l) => {
    const z = l.zone || "zonder zone";
    (acc[z] ||= []).push(l);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {melding && <Melding soort="ok">{melding}</Melding>}
      {fout && <Melding soort="bad">{fout}</Melding>}

      {magBeheren && (
        <Kaart
          titel="Locaties aanmaken"
          actie={
            <Knop variant="secundair" onClick={() => setOpen(!open)}>
              <Icon name={open ? "kruis" : "plus"} size={16} />
              {open ? "Sluiten" : "Reeks toevoegen"}
            </Knop>
          }
        >
          {!open ? (
            <p className="text-sm text-slate">
              Maak een hele gang in één keer aan. De volgorde waarin ze ontstaan is de
              looproute waarop straks gepikt wordt.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Veld label="Zone" hint="Letter of korte code, bv. A">
                  <input
                    className={invoerClasses}
                    value={zone}
                    onChange={(e) => setZone(e.target.value)}
                  />
                </Veld>
                <Veld label="Soort">
                  <select
                    className={invoerClasses}
                    value={soort}
                    onChange={(e) => setSoort(e.target.value)}
                  >
                    {LOCATIE_SOORTEN.map((s) => (
                      <option key={s.waarde} value={s.waarde}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Veld>
                <Veld label="Gangen" hint="bv. 1 of 1-3">
                  <input
                    className={invoerClasses}
                    value={gangen}
                    onChange={(e) => setGangen(e.target.value)}
                  />
                </Veld>
                <Veld label="Stellingen" hint="bv. 1-6">
                  <input
                    className={invoerClasses}
                    value={stellingen}
                    onChange={(e) => setStellingen(e.target.value)}
                  />
                </Veld>
                <Veld label="Niveaus" hint="bv. 1-4">
                  <input
                    className={invoerClasses}
                    value={niveaus}
                    onChange={(e) => setNiveaus(e.target.value)}
                  />
                </Veld>
              </div>
              <Melding soort="info">
                {voorbeeld.aantal} locaties, beginnend bij{" "}
                <span className="font-mono">{voorbeeld.eerste || "?"}</span>
              </Melding>
              <Knop onClick={aanmaken} disabled={bezig || voorbeeld.aantal === 0}>
                {bezig ? "Bezig…" : `${voorbeeld.aantal} locaties aanmaken`}
              </Knop>
            </div>
          )}
        </Kaart>
      )}

      {locaties.length === 0 ? (
        <LeegState tekst="Nog geen locaties. Maak eerst je eerste gang aan." />
      ) : (
        Object.entries(perZone).map(([z, lijst]) => (
          <Kaart key={z} titel={`Zone ${z} — ${lijst.length} locaties`}>
            <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
              {lijst.map((l) => (
                <li
                  key={l.id}
                  className="rounded border border-navy-100 px-2 py-1.5 font-mono text-xs"
                  title={l.name || undefined}
                >
                  {l.code}
                  {!l.pickable && <span className="ml-1 text-slate">(niet pikbaar)</span>}
                </li>
              ))}
            </ul>
          </Kaart>
        ))
      )}
    </div>
  );
}
