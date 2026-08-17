import { instelling } from "@/lib/instellingen";
import { ColliView } from "@/components/ColliView";

export const dynamic = "force-dynamic";

export default async function ColliPagina() {
  const startlocatie = String(await instelling<string>("inslag.startlocatie")) || "ONBEKEND";

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-navy">Colli</h1>
        <p className="text-sm text-slate">
          Een doos of pallet met eigen label. Vullen kost hetzelfde, verplaatsen is één
          handeling in plaats van veertig.
        </p>
      </header>
      <ColliView startlocatie={startlocatie} />
    </div>
  );
}
