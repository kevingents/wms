import Link from "next/link";
import { alleInstellingen, INSTELLINGEN } from "@/lib/instellingen";
import { bootstrapActief } from "@/lib/toegang";
import { huidigeGebruiker } from "@/lib/auth-server";
import { magBeheren } from "@/lib/session";
import { InstellingenView } from "@/components/InstellingenView";
import { Melding } from "@/components/ui/Basis";

export const dynamic = "force-dynamic";

export default async function InstellingenPagina() {
  const [waarden, user, bootstrap] = await Promise.all([
    alleInstellingen(),
    huidigeGebruiker(),
    bootstrapActief(),
  ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-navy">Instellingen</h1>
        <p className="text-sm text-slate">
          Alles wat het magazijn zelf kan aanpassen staat hier — geen redeploy nodig.
        </p>
      </header>

      {bootstrap && (
        <Melding soort="bad">
          Er staat nog niemand in de gebruikerslijst, dus iedereen die kan inloggen heeft
          nu beheerrechten — inclusief instellingen en de boekhouding.{" "}
          <Link href="/gebruikers" className="underline underline-offset-2">
            Wijs een beheerder aan
          </Link>{" "}
          voordat het magazijn live gaat.
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
