import { ScanView } from "@/components/ScanView";
import { instelling } from "@/lib/instellingen";

export const dynamic = "force-dynamic";

export default async function ScanPagina() {
  const bevestigBoven = Number(await instelling<number>("scannen.bevestig_boven")) || 25;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-navy">Scannen</h1>
        <p className="text-sm text-slate">
          Kies wat je doet, scan het artikel en de locatie, vul het aantal in.
        </p>
      </header>
      <ScanView bevestigBoven={bevestigBoven} />
    </div>
  );
}
