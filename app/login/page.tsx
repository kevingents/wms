import { redirect } from "next/navigation";
import { huidigeGebruiker } from "@/lib/auth-server";
import { LoginFormulier } from "@/components/LoginFormulier";

export const dynamic = "force-dynamic";

export default async function LoginPagina({
  searchParams,
}: {
  searchParams: Promise<{ verder?: string }>;
}) {
  const { verder } = await searchParams;
  if (await huidigeGebruiker()) redirect(verder || "/");

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-card">
        <div className="mb-6">
          <h1 className="text-lg font-bold uppercase tracking-widest text-navy">GENTS WMS</h1>
          <p className="mt-1 text-sm text-slate">
            Log in met je personeelsnummer en pincode — dezelfde als in de portal.
          </p>
        </div>
        <LoginFormulier verder={verder || "/"} />
      </div>
    </div>
  );
}
