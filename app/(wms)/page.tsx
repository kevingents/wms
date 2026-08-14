import Link from "next/link";
import { kerncijfers, recenteBoekingen, shadowSamenvatting } from "@/lib/voorraad";
import { instelling } from "@/lib/instellingen";
import { Kaart, Kental, LeegState } from "@/components/ui/Basis";
import { Icon } from "@/components/ui/Icon";
import { REDEN_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

function tijd(iso: string) {
  return new Date(iso).toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  });
}

export default async function Overzicht() {
  const [cijfers, shadow, boekingen, alarmDrempel] = await Promise.all([
    kerncijfers(),
    shadowSamenvatting(),
    recenteBoekingen(12),
    instelling<number>("shadow.diff_alarm"),
  ]);

  const drempel = Number(alarmDrempel) || 10;
  const shadowSoort =
    shadow.skus_met_verschil === 0 ? "ok" : shadow.skus_met_verschil > drempel ? "bad" : "warn";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-navy">Overzicht</h1>
        <p className="text-sm text-slate">
          Voorraad per locatie in het magazijn. SRS draait er nog naast — zie SRS-check.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kental label="Stuks" waarde={cijfers.stuks.toLocaleString("nl-NL")} />
        <Kental label="Artikelen" waarde={cijfers.skus.toLocaleString("nl-NL")} />
        <Kental
          label="Locaties"
          waarde={cijfers.locaties}
          toelichting={`${cijfers.bezette_locaties} bezet`}
        />
        <Kental label="Boekingen vandaag" waarde={cijfers.boekingen_vandaag} />
      </div>

      <Kaart
        titel="Verschil met SRS"
        actie={
          <Link
            href="/shadow"
            className="flex items-center gap-1 text-sm font-medium text-navy underline underline-offset-2"
          >
            Bekijken <Icon name="pijl" size={14} />
          </Link>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kental
            label="SKU's met verschil"
            waarde={shadow.skus_met_verschil.toLocaleString("nl-NL")}
            soort={shadowSoort as "ok" | "warn" | "bad"}
            toelichting={`drempel ${drempel}`}
          />
          <Kental
            label="Stuks verschil"
            waarde={shadow.stuks_verschil.toLocaleString("nl-NL")}
            soort={shadowSoort as "ok" | "warn" | "bad"}
          />
          <Kental
            label="SRS magazijn"
            waarde={shadow.srs_stuks.toLocaleString("nl-NL")}
            toelichting={`${shadow.srs_skus} sku's`}
          />
          <Kental
            label="WMS magazijn"
            waarde={shadow.wms_stuks.toLocaleString("nl-NL")}
            toelichting={`${shadow.wms_skus} sku's`}
          />
        </div>
        {shadow.wms_stuks === 0 && (
          <p className="mt-3 rounded-lg bg-navy-50 px-3 py-2 text-sm text-slate">
            Het WMS is nog leeg. Maak eerst locaties aan en boek dan de beginvoorraad in
            — tot die tijd is het verschil met SRS logischerwijs het volledige magazijn.
          </p>
        )}
      </Kaart>

      <Kaart titel="Laatste boekingen">
        {boekingen.length === 0 ? (
          <LeegState tekst="Nog geen boekingen." />
        ) : (
          <ul className="divide-y divide-navy-100">
            {boekingen.map((b) => (
              <li key={b.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-12 shrink-0 text-xs tabular-nums text-slate">
                  {tijd(b.created_at)}
                </span>
                <span className="w-10 shrink-0 text-right font-bold tabular-nums">
                  {b.qty}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {b.omschrijving || b.sku}
                  </span>
                  <span className="block truncate font-mono text-xs text-slate">
                    {b.van_code || "buiten"} → {b.naar_code || "buiten"}
                  </span>
                </span>
                <span className="shrink-0 rounded bg-navy-50 px-2 py-0.5 text-xs">
                  {REDEN_LABELS[b.reason] ?? b.reason}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Kaart>
    </div>
  );
}
