import { openRondes } from "@/lib/rondes";
import { werkvoorraad } from "@/lib/picken";
import { instelling } from "@/lib/instellingen";
import { RondeSamenstellen } from "@/components/RondeSamenstellen";

export const dynamic = "force-dynamic";

export default async function RondesPagina() {
  const [rondes, opdrachten, maxBakken] = await Promise.all([
    openRondes(),
    werkvoorraad(),
    instelling<number>("picken.bakken_per_kar"),
  ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-navy">Pickrondes</h1>
        <p className="text-sm text-slate">
          Verzamel orders tot één ronde en loop het magazijn één keer door — één bak per
          order.
        </p>
      </header>
      <RondeSamenstellen
        rondes={rondes}
        opdrachten={opdrachten}
        maxBakken={Number(maxBakken) || 12}
      />
    </div>
  );
}
