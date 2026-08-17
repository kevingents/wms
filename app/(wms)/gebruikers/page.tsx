import { redirect } from "next/navigation";
import { huidigeGebruiker } from "@/lib/auth-server";
import { magBeheren } from "@/lib/session";
import { GebruikersBeheer } from "@/components/GebruikersBeheer";

export const dynamic = "force-dynamic";

export default async function GebruikersPagina() {
  const user = await huidigeGebruiker();
  /* Niet alleen de API afschermen maar ook de pagina: een scherm dat laadt en
     dan volloopt met foutmeldingen is verwarrender dan er niet komen. */
  if (!magBeheren(user)) redirect("/terminal");

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-navy">Gebruikers</h1>
        <p className="text-sm text-slate">
          Wie mag wat. Medewerkers verschijnen vanzelf zodra ze een keer inloggen.
        </p>
      </header>
      <GebruikersBeheer />
    </div>
  );
}
