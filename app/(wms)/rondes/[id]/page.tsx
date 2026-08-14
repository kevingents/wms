import Link from "next/link";
import { notFound } from "next/navigation";
import { ronde, rondeBakken, rondeStops } from "@/lib/rondes";
import { instelling } from "@/lib/instellingen";
import { RondeLopen } from "@/components/RondeLopen";
import { Icon } from "@/components/ui/Icon";

export const dynamic = "force-dynamic";

export default async function RondePagina({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const gevonden = await ronde(Number(id));
  if (!gevonden) notFound();

  const [bakken, stops, scanLocatie, scanArtikel] = await Promise.all([
    rondeBakken(gevonden.id),
    rondeStops(gevonden.id),
    instelling<boolean>("picken.scan_locatie_verplicht"),
    instelling<boolean>("picken.scan_artikel_verplicht"),
  ]);

  return (
    <div className="space-y-4">
      <Link
        href="/rondes"
        className="inline-flex items-center gap-1 text-sm text-slate underline underline-offset-2"
      >
        <Icon name="pijl" size={14} className="rotate-180" />
        Terug naar de rondes
      </Link>
      <RondeLopen
        ronde={gevonden}
        bakken={bakken}
        stops={stops}
        scanLocatieVerplicht={Boolean(scanLocatie)}
        scanArtikelVerplicht={Boolean(scanArtikel)}
      />
    </div>
  );
}
