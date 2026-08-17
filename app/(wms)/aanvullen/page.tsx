import { huidigeGebruiker } from "@/lib/auth-server";
import { magBeheren } from "@/lib/session";
import { AanvulView } from "@/components/AanvulView";

export const dynamic = "force-dynamic";

export default async function AanvullenPagina() {
  const user = await huidigeGebruiker();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-navy">Winkelaanvulling</h1>
        <p className="text-sm text-slate">
          Wat de winkels tekortkomen en het magazijn kan leveren. Eerlijk verdeeld, niet
          wie-het-eerst-vraagt.
        </p>
      </header>
      <AanvulView magBeheren={magBeheren(user)} />
    </div>
  );
}
