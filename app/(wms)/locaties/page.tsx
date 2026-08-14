import { alleLocaties } from "@/lib/voorraad";
import { huidigeGebruiker } from "@/lib/auth-server";
import { magBeheren } from "@/lib/session";
import { LocatiesBeheer } from "@/components/LocatiesBeheer";

export const dynamic = "force-dynamic";

export default async function LocatiesPagina() {
  const [locaties, user] = await Promise.all([alleLocaties(), huidigeGebruiker()]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-navy">Locaties</h1>
        <p className="text-sm text-slate">
          Elke plek waar voorraad kan liggen. De volgorde bepaalt de looproute.
        </p>
      </header>
      <LocatiesBeheer locaties={locaties} magBeheren={magBeheren(user)} />
    </div>
  );
}
