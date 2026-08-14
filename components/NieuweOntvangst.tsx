"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Kaart, Knop, Melding, Veld, invoerClasses } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";

/**
 * Levering aanmelden.
 *
 * De regels kun je plakken uit een pakbon: één regel per artikel, sku en aantal
 * gescheiden door een spatie, komma of tab. Dat is sneller dan een formulier met
 * plusknoppen, en het werkt met wat de leverancier toch al aanlevert.
 *
 * Een levering zonder regels mag ook — dan tel je blind en voegt de ontvanger
 * elk artikel toe terwijl hij uitpakt.
 */
export function NieuweOntvangst() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [leverancier, setLeverancier] = useState("");
  const [referentie, setReferentie] = useState("");
  const [verwachtOp, setVerwachtOp] = useState("");
  const [plak, setPlak] = useState("");
  const [fout, setFout] = useState("");
  const [bezig, setBezig] = useState(false);

  /** "2900001326124 5" of "2900001326124,5" of met tab — allemaal goed. */
  function leesRegels(tekst: string) {
    return tekst
      .split(/\r?\n/)
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => {
        const delen = r.split(/[\s,;\t]+/).filter(Boolean);
        const sku = delen[0];
        const verwacht = delen.length > 1 ? Number(delen[delen.length - 1]) : 0;
        return { sku, verwacht: Number.isFinite(verwacht) ? Math.floor(verwacht) : 0 };
      })
      .filter((r) => r.sku);
  }

  const regels = leesRegels(plak);

  async function aanmelden() {
    setBezig(true);
    setFout("");
    try {
      const res = await fetch("/api/ontvangst", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actie: "nieuw",
          bron: "leverancier",
          leverancier,
          referentie,
          verwachtOp: verwachtOp || null,
          regels,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Aanmelden mislukt.");
        return;
      }
      setOpen(false);
      setLeverancier("");
      setReferentie("");
      setPlak("");
      router.push(`/ontvangst/${data.ontvangst.id}`);
      router.refresh();
    } catch {
      setFout("Geen verbinding met de server.");
    } finally {
      setBezig(false);
    }
  }

  return (
    <Kaart
      titel="Levering aanmelden"
      actie={
        <Knop variant="secundair" onClick={() => setOpen(!open)}>
          <Icon name={open ? "kruis" : "plus"} size={16} />
          {open ? "Sluiten" : "Nieuwe levering"}
        </Knop>
      }
    >
      {!open ? (
        <p className="text-sm text-slate">
          Meld aan wat er binnenkomt, met de verwachte aantallen van de pakbon. Zonder
          verwachting kun je niet zien dat er te weinig geleverd is.
        </p>
      ) : (
        <div className="space-y-3">
          {fout && <Melding soort="bad">{fout}</Melding>}
          <div className="grid gap-3 sm:grid-cols-3">
            <Veld label="Leverancier">
              <input
                className={invoerClasses}
                value={leverancier}
                onChange={(e) => setLeverancier(e.target.value)}
              />
            </Veld>
            <Veld label="Referentie" hint="Pakbon- of ordernummer">
              <input
                className={invoerClasses}
                value={referentie}
                onChange={(e) => setReferentie(e.target.value)}
              />
            </Veld>
            <Veld label="Verwacht op">
              <input
                type="date"
                className={invoerClasses}
                value={verwachtOp}
                onChange={(e) => setVerwachtOp(e.target.value)}
              />
            </Veld>
          </div>

          <Veld
            label="Regels van de pakbon"
            hint="Eén per regel: sku en aantal. Plakken uit een sheet werkt ook."
          >
            <textarea
              className={`${invoerClasses} min-h-32 py-2 font-mono text-sm`}
              value={plak}
              onChange={(e) => setPlak(e.target.value)}
              placeholder={"2900001326124 5\n2900004711033 2"}
            />
          </Veld>

          <Melding soort="info">
            {regels.length === 0
              ? "Nog geen regels — je kunt ook blind ontvangen en tijdens het uitpakken toevoegen."
              : `${regels.length} regels, ${regels.reduce((s, r) => s + r.verwacht, 0)} stuks verwacht.`}
          </Melding>

          <Knop onClick={aanmelden} disabled={bezig}>
            {bezig ? "Bezig…" : "Levering aanmelden"}
          </Knop>
        </div>
      )}
    </Kaart>
  );
}
