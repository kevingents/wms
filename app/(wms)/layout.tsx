import { redirect } from "next/navigation";
import { huidigeGebruiker } from "@/lib/auth-server";
import { instelling } from "@/lib/instellingen";
import { isDbConfigured } from "@/lib/db";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function WmsLayout({ children }: { children: React.ReactNode }) {
  const user = await huidigeGebruiker();
  if (!user) redirect("/login");

  /* De magazijnnaam is een instelling, geen env-var — zie lib/instellingen.ts. */
  const magazijn = isDbConfigured()
    ? String(await instelling<string>("magazijn.naam"))
    : "GENTS Magazijn";

  return (
    <AppShell gebruiker={user.name} magazijn={magazijn}>
      {children}
    </AppShell>
  );
}
