import {
  sluitcontrole,
  grootboekBalans,
  waardePerZone,
  ontbrekendeWaarde,
  perioden,
  slottingAdvies,
} from "@/lib/financieel";
import { instelling } from "@/lib/instellingen";
import { huidigeGebruiker } from "@/lib/auth-server";
import { magBeheren } from "@/lib/session";
import { FinancieelView } from "@/components/FinancieelView";

export const dynamic = "force-dynamic";

export default async function FinancieelPagina() {
  const [controle, balans, zones, ontbreekt, maanden, slotting, glVoorraad, user] =
    await Promise.all([
      sluitcontrole(),
      grootboekBalans(),
      waardePerZone(),
      ontbrekendeWaarde(50),
      perioden(12),
      slottingAdvies(20),
      instelling<string>("financieel.gl_voorraad"),
      huidigeGebruiker(),
    ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-navy">Financieel</h1>
        <p className="text-sm text-slate">
          Voorraadwaarde, grootboek en periodeafsluiting. Elke mutatie krijgt zijn waarde
          op het moment van boeken en houdt die voorgoed.
        </p>
      </header>
      <FinancieelView
        controle={controle}
        balans={balans}
        zones={zones}
        ontbreekt={ontbreekt}
        perioden={maanden}
        slotting={slotting}
        magBeheren={magBeheren(user)}
        glIngesteld={Boolean(String(glVoorraad || "").trim())}
      />
    </div>
  );
}
