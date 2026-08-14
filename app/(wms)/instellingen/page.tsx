import { alleInstellingen, INSTELLINGEN } from "@/lib/instellingen";
import { rolToewijzingen } from "@/lib/toegang";
import { huidigeGebruiker } from "@/lib/auth-server";
import { magBeheren } from "@/lib/session";
import { InstellingenView } from "@/components/InstellingenView";
import { Melding } from "@/components/ui/Basis";

export const dynamic = "force-dynamic";

export default async function InstellingenPagina() {
  const [waarden, user, rollen] = await Promise.all([
    alleInstellingen(),
    huidigeGebruiker(),
    rolToewijzingen(),
  ]);

  const bootstrap = Object.keys(rollen).length === 0;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-navy">Instellingen</h1>
        <p className="text-sm text-slate">
          Alles wat het magazijn zelf kan aanpassen staat hier — geen redeploy nodig.
        </p>
      </header>

      {bootstrap && (
        <Melding soort="warn">
          Er zijn nog geen rollen toegewezen, dus iedereen die kan inloggen heeft nu
          beheerrechten. Wijs een beheerder toe zodra het magazijn live gaat.
        </Melding>
      )}

      <InstellingenView
        definities={INSTELLINGEN}
        waarden={waarden}
        magBeheren={magBeheren(user)}
      />
    </div>
  );
}
