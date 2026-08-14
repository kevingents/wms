import Link from "next/link";
import { notFound } from "next/navigation";
import { ontvangst, ontvangstRegels } from "@/lib/ontvangst";
import { instelling } from "@/lib/instellingen";
import { OntvangstView } from "@/components/OntvangstView";
import { Icon } from "@/components/ui/Icon";

export const dynamic = "force-dynamic";

export default async function OntvangstDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const gevonden = await ontvangst(Number(id));
  if (!gevonden) notFound();

  const [regels, standaardLocatie] = await Promise.all([
    ontvangstRegels(gevonden.id),
    instelling<string>("inslag.startlocatie"),
  ]);

  return (
    <div className="space-y-4">
      <Link
        href="/ontvangst"
        className="inline-flex items-center gap-1 text-sm text-slate underline underline-offset-2"
      >
        <Icon name="pijl" size={14} className="rotate-180" />
        Terug naar ontvangsten
      </Link>
      <OntvangstView
        ontvangst={gevonden}
        regels={regels}
        standaardLocatie={String(standaardLocatie) || "ONBEKEND"}
      />
    </div>
  );
}
