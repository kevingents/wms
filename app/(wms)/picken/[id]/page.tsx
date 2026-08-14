import Link from "next/link";
import { notFound } from "next/navigation";
import { pickOpdracht, pickRegels } from "@/lib/picken";
import { instelling } from "@/lib/instellingen";
import { PickRonde } from "@/components/PickRonde";
import { Icon } from "@/components/ui/Icon";

export const dynamic = "force-dynamic";

export default async function PickRondePagina({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const opdracht = await pickOpdracht(Number(id));
  if (!opdracht) notFound();

  const [regels, scanLocatie, scanArtikel] = await Promise.all([
    pickRegels(opdracht.id),
    instelling<boolean>("picken.scan_locatie_verplicht"),
    instelling<boolean>("picken.scan_artikel_verplicht"),
  ]);

  return (
    <div className="space-y-4">
      <Link
        href="/picken"
        className="inline-flex items-center gap-1 text-sm text-slate underline underline-offset-2"
      >
        <Icon name="pijl" size={14} className="rotate-180" />
        Terug naar de werkvoorraad
      </Link>
      <PickRonde
        opdracht={opdracht}
        regels={regels}
        scanLocatieVerplicht={Boolean(scanLocatie)}
        scanArtikelVerplicht={Boolean(scanArtikel)}
      />
    </div>
  );
}
