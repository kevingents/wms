import { openSignalen } from "@/lib/signalen";
import { huidigeGebruiker } from "@/lib/auth-server";
import { magBeheren } from "@/lib/session";
import { SignalenView } from "@/components/SignalenView";

export const dynamic = "force-dynamic";

export default async function SignalenPagina() {
  const [signalen, user] = await Promise.all([openSignalen(100), huidigeGebruiker()]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-navy">Signalen</h1>
        <p className="text-sm text-slate">
          Dingen die niemand als foutmelding ziet maar wel scheefgaan als er niets
          gebeurt.
        </p>
      </header>
      <SignalenView signalen={signalen} magBeheren={magBeheren(user)} />
    </div>
  );
}
