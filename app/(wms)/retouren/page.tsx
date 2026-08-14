import { openRetouren } from "@/lib/retouren";
import { instelling } from "@/lib/instellingen";
import { RetourView } from "@/components/RetourView";

export const dynamic = "force-dynamic";

export default async function RetourenPagina() {
  const [retouren, standaardLocatie] = await Promise.all([
    openRetouren(),
    instelling<string>("inslag.startlocatie"),
  ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-navy">Retouren</h1>
        <p className="text-sm text-slate">
          Aannemen en meteen beoordelen: terug het schap in, naar herstel, of afkeur.
        </p>
      </header>
      <RetourView
        retouren={retouren}
        standaardLocatie={String(standaardLocatie) || "ONBEKEND"}
      />
    </div>
  );
}
