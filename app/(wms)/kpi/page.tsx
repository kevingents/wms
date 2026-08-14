import {
  doorvoer,
  productiviteit,
  doorlooptijden,
  nauwkeurigheid,
  werkstand,
  auditLog,
} from "@/lib/kpi";
import { Kaart, Kental, LeegState } from "@/components/ui/Basis";

export const dynamic = "force-dynamic";

function tijd(iso: string) {
  return new Date(iso).toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  });
}

export default async function KpiPagina() {
  const [dagen, mensen, doorloop, telling, stand, audit] = await Promise.all([
    doorvoer(14),
    productiviteit(7),
    doorlooptijden(30),
    nauwkeurigheid(30),
    werkstand(),
    auditLog(25),
  ]);

  const maxStuks = Math.max(...dagen.map((d) => d.stuks), 1);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-navy">Cijfers</h1>
        <p className="text-sm text-slate">
          Alles uit het grootboek zelf. Wat geboekt is, is gedaan — er is geen aparte
          registratie die iemand moet bijhouden.
        </p>
      </header>

      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate">
          Nu open
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kental
            label="Pickopdrachten"
            waarde={stand.pick_open + stand.pick_bezig}
            toelichting={`${stand.pick_bezig} onderhanden`}
          />
          <Kental label="Taken" waarde={stand.taken_open} />
          <Kental
            label="Inpakken"
            waarde={stand.zending_open}
            toelichting="dozen aan tafel"
          />
          <Kental
            label="Oudste pick"
            waarde={stand.oudste_pick_uren !== null ? `${stand.oudste_pick_uren} u` : "—"}
            soort={
              stand.oudste_pick_uren !== null && stand.oudste_pick_uren > 24
                ? "bad"
                : stand.oudste_pick_uren !== null && stand.oudste_pick_uren > 8
                  ? "warn"
                  : "ok"
            }
            toelichting="blijft er iets liggen?"
          />
          <Kental label="Ontvangsten" waarde={stand.ontvangst_open} />
          <Kental label="Retouren" waarde={stand.retour_open} />
          <Kental label="Rondes" waarde={stand.rondes_open} />
          <Kental
            label="Telnauwkeurigheid"
            waarde={
              telling.percentage_goed !== null ? `${telling.percentage_goed}%` : "—"
            }
            soort={
              telling.percentage_goed === null
                ? "neutraal"
                : telling.percentage_goed >= 98
                  ? "ok"
                  : telling.percentage_goed >= 95
                    ? "warn"
                    : "bad"
            }
            toelichting={`${telling.geteld} regels, 30 dagen`}
          />
        </div>
      </div>

      <Kaart titel="Doorvoer per dag (14 dagen)">
        {dagen.length === 0 ? (
          <LeegState tekst="Nog geen boekingen." />
        ) : (
          <ul className="space-y-1.5">
            {dagen.map((d) => (
              <li key={d.dag} className="flex items-center gap-3 text-sm">
                <span className="w-20 shrink-0 text-xs text-slate">
                  {new Date(d.dag).toLocaleDateString("nl-NL", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                </span>
                <span className="flex h-5 flex-1 overflow-hidden rounded bg-navy-50">
                  <span
                    className="h-full bg-navy"
                    style={{ width: `${(d.stuks / maxStuks) * 100}%` }}
                  />
                </span>
                <span className="w-16 shrink-0 text-right font-semibold tabular-nums">
                  {d.stuks}
                </span>
                <span className="hidden w-40 shrink-0 text-right text-xs text-slate sm:block">
                  {d.ontvangen > 0 && `${d.ontvangen} in · `}
                  {d.gepikt > 0 && `${d.gepikt} gepikt · `}
                  {d.verzonden > 0 && `${d.verzonden} uit`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Kaart>

      <Kaart titel="Productiviteit (7 dagen)">
        <p className="mb-2 text-xs text-slate">
          Actieve tijd is de spanne tussen eerste en laatste boeking van een dag, inclusief
          pauzes. Het is dus een ondergrens van het tempo — bedoeld om te zien waar het
          proces stroef loopt, niet om mensen af te rekenen.
        </p>
        {mensen.length === 0 ? (
          <LeegState tekst="Nog geen boekingen." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-100 text-left text-xs uppercase tracking-wide text-slate">
                  <th className="py-2 pr-3 font-semibold">Medewerker</th>
                  <th className="py-2 pr-3 text-right font-semibold">Boekingen</th>
                  <th className="py-2 pr-3 text-right font-semibold">Stuks</th>
                  <th className="py-2 pr-3 text-right font-semibold">Actief</th>
                  <th className="py-2 text-right font-semibold">Per uur</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {mensen.map((m) => (
                  <tr key={m.medewerker}>
                    <td className="py-2 pr-3">{m.medewerker}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.boekingen}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.stuks}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate">
                      {Math.round(m.actieve_minuten / 60)} u
                    </td>
                    <td className="py-2 text-right font-semibold tabular-nums">
                      {m.per_uur}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Kaart>

      <Kaart titel="Doorlooptijd pickopdrachten (30 dagen)">
        <p className="mb-2 text-xs text-slate">
          Lange wachttijd betekent te weinig mensen of te laat vrijgeven; lange werktijd
          betekent dat de looproute of de indeling niet klopt. Twee heel verschillende
          oplossingen, dus de splitsing is het nuttigste getal hier.
        </p>
        {doorloop.length === 0 ? (
          <LeegState tekst="Nog geen afgeronde opdrachten." />
        ) : (
          <ul className="divide-y divide-navy-100">
            {doorloop.map((d) => (
              <li key={d.bron} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-28 shrink-0 font-medium">{d.bron}</span>
                <span className="w-16 shrink-0 text-right text-slate tabular-nums">
                  {d.opdrachten}×
                </span>
                <span className="flex-1 text-right tabular-nums">
                  <span className="text-warn">{d.gem_wacht_minuten ?? "—"} min wacht</span>
                  {" · "}
                  <span className="font-semibold">{d.gem_werk_minuten ?? "—"} min werk</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Kaart>

      <Kaart titel="Wijzigingen buiten de voorraad">
        <p className="mb-2 text-xs text-slate">
          Het grootboek verantwoordt elke beweging van een artikel. Dit verantwoordt de
          rest: wie zette een instelling om, wie deactiveerde een locatie.
        </p>
        {audit.length === 0 ? (
          <LeegState tekst="Nog niets vastgelegd." />
        ) : (
          <ul className="divide-y divide-navy-100">
            {audit.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-28 shrink-0 text-xs text-slate">
                  {tijd(a.created_at)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {a.actie} — {a.object_type}
                    {a.object_id ? ` ${a.object_id}` : ""}
                  </span>
                  {a.note && (
                    <span className="block truncate text-xs text-slate">{a.note}</span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-slate">
                  {a.actor_naam ?? "systeem"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Kaart>
    </div>
  );
}
