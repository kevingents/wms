import { beginvoorraadVoorbeeld, indeelVoortgang } from "@/lib/inslag";
import { instelling } from "@/lib/instellingen";
import { huidigeGebruiker } from "@/lib/auth-server";
import { magBeheren } from "@/lib/session";
import { InslagView } from "@/components/InslagView";

export const dynamic = "force-dynamic";

export default async function InslagPagina() {
  const [voorbeeld, voortgang, standaardAantal, user] = await Promise.all([
    beginvoorraadVoorbeeld(),
    indeelVoortgang(),
    instelling<number>("inslag.standaard_aantal"),
    huidigeGebruiker(),
  ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-navy">Inslag</h1>
        <p className="text-sm text-slate">
          Voorraad het systeem in. Scan de locatie één keer, daarna artikel na artikel.
        </p>
      </header>
      <InslagView
        voorbeeld={voorbeeld}
        voortgang={voortgang}
        standaardAantal={Number(standaardAantal) || 1}
        magBeheren={magBeheren(user)}
      />
    </div>
  );
}
