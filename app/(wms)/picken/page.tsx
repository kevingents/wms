import { werkvoorraad } from "@/lib/picken";
import { PickLijst } from "@/components/PickLijst";

export const dynamic = "force-dynamic";

export default async function PickenPagina() {
  const opdrachten = await werkvoorraad();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-navy">Picken</h1>
        <p className="text-sm text-slate">
          Weborders en winkeltransfers die het magazijn moet uitleveren.
        </p>
      </header>
      <PickLijst opdrachten={opdrachten} />
    </div>
  );
}
