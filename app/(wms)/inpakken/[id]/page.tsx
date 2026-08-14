import Link from "next/link";
import { notFound } from "next/navigation";
import { zending, zendingRegels, doosTypes } from "@/lib/inpakken";
import { instelling } from "@/lib/instellingen";
import { huidigeGebruiker } from "@/lib/auth-server";
import { magBeheren } from "@/lib/session";
import { PakTafel } from "@/components/PakTafel";
import { Icon } from "@/components/ui/Icon";

export const dynamic = "force-dynamic";

export default async function InpakDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const gevonden = await zending(Number(id));
  if (!gevonden) notFound();

  const [regels, dozen, vervoerder, user] = await Promise.all([
    zendingRegels(gevonden.id),
    doosTypes(),
    instelling<string>("inpakken.standaard_vervoerder"),
    huidigeGebruiker(),
  ]);

  return (
    <div className="space-y-4">
      <Link
        href="/inpakken"
        className="inline-flex items-center gap-1 text-sm text-slate underline underline-offset-2"
      >
        <Icon name="pijl" size={14} className="rotate-180" />
        Terug naar de paktafel
      </Link>
      <PakTafel
        zending={gevonden}
        regels={regels}
        doosTypes={dozen}
        standaardVervoerder={String(vervoerder) || "DHL"}
        magForceren={magBeheren(user)}
      />
    </div>
  );
}
