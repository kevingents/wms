import { shadowSamenvatting, shadowVerschillen } from "@/lib/voorraad";
import { instelling } from "@/lib/instellingen";
import { Kaart, Kental, LeegState } from "@/components/ui/Basis";

export const dynamic = "force-dynamic";

/**
 * Shadow-dashboard. Zolang SRS de waarheid is draait het WMS ernaast mee en
 * vergelijken we per SKU. Dit scherm is het criterium voor de cutover: pas als
 * deze lijst structureel leeg blijft, mag het WMS leidend worden.
 */
export default async function ShadowPagina() {
  const [samenvatting, verschillen, drempel] = await Promise.all([
    shadowSamenvatting(),
    shadowVerschillen(100),
    instelling<number>("shadow.diff_alarm"),
  ]);

  const alarm = Number(drempel) || 10;
  const soort =
    samenvatting.skus_met_verschil === 0
      ? "ok"
      : samenvatting.skus_met_verschil > alarm
        ? "bad"
        : "warn";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-navy">SRS-check</h1>
        <p className="text-sm text-slate">
          WMS-voorraad naast de laatste SRS-spiegel van branch 99 (GENTS Magazijn).
          Een positief verschil betekent dat het WMS méér ziet dan SRS.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kental
          label="SKU's met verschil"
          waarde={samenvatting.skus_met_verschil.toLocaleString("nl-NL")}
          soort={soort as "ok" | "warn" | "bad"}
          toelichting={`alarm boven ${alarm}`}
        />
        <Kental
          label="Stuks verschil"
          waarde={samenvatting.stuks_verschil.toLocaleString("nl-NL")}
          soort={soort as "ok" | "warn" | "bad"}
        />
        <Kental
          label="SRS"
          waarde={samenvatting.srs_stuks.toLocaleString("nl-NL")}
          toelichting={`${samenvatting.srs_skus} sku's`}
        />
        <Kental
          label="WMS"
          waarde={samenvatting.wms_stuks.toLocaleString("nl-NL")}
          toelichting={`${samenvatting.wms_skus} sku's`}
        />
      </div>

      <Kaart titel={`Grootste afwijkingen (top ${verschillen.length})`}>
        {verschillen.length === 0 ? (
          <LeegState tekst="Geen verschillen. Als dit een week aanhoudt, is de cutover verantwoord." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-100 text-left text-xs uppercase tracking-wide text-slate">
                  <th className="py-2 pr-3 font-semibold">SKU</th>
                  <th className="py-2 pr-3 font-semibold">Artikel</th>
                  <th className="py-2 pr-3 text-right font-semibold">SRS</th>
                  <th className="py-2 pr-3 text-right font-semibold">WMS</th>
                  <th className="py-2 text-right font-semibold">Verschil</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {verschillen.map((v) => (
                  <tr key={v.sku}>
                    <td className="py-2 pr-3 font-mono text-xs">{v.sku}</td>
                    <td className="max-w-[16rem] truncate py-2 pr-3">
                      {v.omschrijving || <span className="text-slate">onbekend</span>}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{v.srs_qty}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{v.wms_qty}</td>
                    <td
                      className={`py-2 text-right font-semibold tabular-nums ${
                        v.diff > 0 ? "text-warn" : "text-bad"
                      }`}
                    >
                      {v.diff > 0 ? `+${v.diff}` : v.diff}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Kaart>
    </div>
  );
}
