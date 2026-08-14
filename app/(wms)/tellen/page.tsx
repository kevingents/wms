import { TelView } from "@/components/TelView";
import { instelling } from "@/lib/instellingen";

export const dynamic = "force-dynamic";

export default async function TellenPagina() {
  const blind = Boolean(await instelling<boolean>("tellen.blindtellen"));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-navy">Tellen</h1>
        <p className="text-sm text-slate">
          Scan een locatie en tel wat er ligt. Het getelde aantal wordt de nieuwe stand.
        </p>
      </header>
      <TelView blind={blind} />
    </div>
  );
}
