import { openTaken, replenAdvies, telKandidaten } from "@/lib/taken";
import { huidigeGebruiker } from "@/lib/auth-server";
import { magBeheren } from "@/lib/session";
import { TakenView } from "@/components/TakenView";

export const dynamic = "force-dynamic";

export default async function TakenPagina() {
  const [taken, replen, kandidaten, user] = await Promise.all([
    openTaken(),
    replenAdvies(),
    telKandidaten(15),
    huidigeGebruiker(),
  ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-navy">Taken</h1>
        <p className="text-sm text-slate">
          Aanvullen, tellen en opruimen — één lijst op looproute. Pak de bovenste.
        </p>
      </header>
      <TakenView
        taken={taken}
        replen={replen}
        telkandidaten={kandidaten}
        magBeheren={magBeheren(user)}
      />
    </div>
  );
}
