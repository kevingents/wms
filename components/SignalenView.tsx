"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Kaart, Knop, Melding, LeegState } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import type { Ernst, Signaal } from "@/lib/signalen";

/**
 * Signalen afhandelen.
 *
 * Twee eindstations met verschillende betekenis: afgehandeld zegt "opgelost",
 * genegeerd zegt "gezien en akkoord". Dat onderscheid is later het verschil
 * tussen een probleem en een uitzondering — en dat wil je kunnen terugzoeken.
 */

const ERNST_LABEL: Record<Ernst, string> = {
  urgent: "Urgent",
  let_op: "Let op",
  info: "Info",
};

const ERNST_STIJL: Record<Ernst, string> = {
  urgent: "border-bad bg-bad-50",
  let_op: "border-warn bg-warn-50",
  info: "border-navy-100 bg-white",
};

const ERNST_TEKST: Record<Ernst, string> = {
  urgent: "text-bad",
  let_op: "text-warn",
  info: "text-slate",
};

export function SignalenView({
  signalen: initieel,
  magBeheren,
}: {
  signalen: Signaal[];
  magBeheren: boolean;
}) {
  const router = useRouter();
  const [signalen, setSignalen] = useState(initieel);
  const [melding, setMelding] = useState("");
  const [fout, setFout] = useState("");
  const [bezig, setBezig] = useState(false);

  async function actie(body: Record<string, unknown>) {
    setBezig(true);
    setFout("");
    try {
      const res = await fetch("/api/signalen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFout(data.message || "Actie mislukt.");
        return null;
      }
      return data;
    } catch {
      setFout("Geen verbinding met de server.");
      return null;
    } finally {
      setBezig(false);
    }
  }

  async function verversen() {
    const res = await fetch("/api/signalen");
    const data = await res.json();
    if (data.ok) setSignalen(data.signalen);
    router.refresh();
  }

  async function afhandelen(id: number, hoe: "afhandelen" | "negeren") {
    const data = await actie({ actie: hoe, id });
    if (data) await verversen();
  }

  async function controleer() {
    setMelding("");
    const data = await actie({ actie: "controleer" });
    if (data) {
      setMelding(
        data.nieuw === 0 && data.gesloten === 0
          ? "Controle gedraaid — niets nieuws en niets opgelost."
          : `Controle gedraaid: ${data.nieuw} nieuw, ${data.gesloten} vanzelf opgelost.`
      );
      await verversen();
    }
  }

  const perErnst: Record<Ernst, Signaal[]> = {
    urgent: signalen.filter((s) => s.ernst === "urgent"),
    let_op: signalen.filter((s) => s.ernst === "let_op"),
    info: signalen.filter((s) => s.ernst === "info"),
  };

  return (
    <div className="space-y-4">
      {melding && <Melding soort="ok">{melding}</Melding>}
      {fout && <Melding soort="bad">{fout}</Melding>}

      {magBeheren && (
        <Kaart>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate">
              De controle draait elke ochtend automatisch. Handmatig kan ook — hij is
              idempotent, dus vaker draaien kan geen schade doen.
            </p>
            <Knop variant="secundair" onClick={controleer} disabled={bezig}>
              <Icon name="synchroniseer" size={16} />
              {bezig ? "Bezig…" : "Nu controleren"}
            </Knop>
          </div>
        </Kaart>
      )}

      {signalen.length === 0 ? (
        <Kaart>
          <Melding soort="ok">
            <span className="flex items-center gap-2">
              <Icon name="vink" size={16} />
              Niets aan de hand — geen open signalen.
            </span>
          </Melding>
        </Kaart>
      ) : (
        (["urgent", "let_op", "info"] as Ernst[]).map((ernst) =>
          perErnst[ernst].length === 0 ? null : (
            <Kaart key={ernst} titel={`${ERNST_LABEL[ernst]} (${perErnst[ernst].length})`}>
              <ul className="space-y-2">
                {perErnst[ernst].map((s) => (
                  <li
                    key={s.id}
                    className={cn("rounded-lg border-2 p-3", ERNST_STIJL[ernst])}
                  >
                    <div className="flex items-start gap-3">
                      <Icon
                        name={ernst === "info" ? "klok" : "alert"}
                        size={20}
                        className={cn("mt-0.5 shrink-0", ERNST_TEKST[ernst])}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-navy">{s.titel}</div>
                        {s.toelichting && (
                          <div className="mt-0.5 text-sm text-slate">{s.toelichting}</div>
                        )}
                        <div className="mt-1 font-mono text-xs text-slate">
                          {s.soort}
                          {s.ref_id ? ` · ${s.ref_id}` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Knop
                        variant="secundair"
                        onClick={() => afhandelen(s.id, "afhandelen")}
                        disabled={bezig}
                      >
                        <Icon name="vink" size={16} />
                        Opgelost
                      </Knop>
                      <Knop
                        variant="stil"
                        onClick={() => afhandelen(s.id, "negeren")}
                        disabled={bezig}
                      >
                        Gezien, akkoord
                      </Knop>
                    </div>
                  </li>
                ))}
              </ul>
            </Kaart>
          )
        )
      )}

      {signalen.length === 0 && (
        <LeegState tekst="Signalen verschijnen hier zodra de bewaking iets vindt: werk dat blijft liggen, een sluitcontrole die wegloopt, een leeg pikvak." />
      )}
    </div>
  );
}
