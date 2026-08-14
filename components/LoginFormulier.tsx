"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Knop, Veld, Melding, invoerClasses } from "@/components/ui/Basis";

export function LoginFormulier({ verder }: { verder: string }) {
  const router = useRouter();
  const [personnelId, setPersonnelId] = useState("");
  const [pincode, setPincode] = useState("");
  const [fout, setFout] = useState("");
  const [bezig, setBezig] = useState(false);

  async function versturen(e: React.FormEvent) {
    e.preventDefault();
    setFout("");
    setBezig(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personnelId, pincode }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !data.ok) {
        setFout(data.message || "Inloggen mislukt.");
        return;
      }
      router.replace(verder);
      router.refresh();
    } catch {
      setFout("Geen verbinding met de server.");
    } finally {
      setBezig(false);
    }
  }

  return (
    <form onSubmit={versturen} className="space-y-4">
      <Veld label="Personeelsnummer">
        <input
          className={invoerClasses}
          value={personnelId}
          onChange={(e) => setPersonnelId(e.target.value)}
          inputMode="numeric"
          autoComplete="username"
          autoFocus
          required
        />
      </Veld>
      <Veld label="Pincode">
        <input
          className={invoerClasses}
          type="password"
          value={pincode}
          onChange={(e) => setPincode(e.target.value)}
          inputMode="numeric"
          autoComplete="current-password"
          required
        />
      </Veld>
      {fout && <Melding soort="bad">{fout}</Melding>}
      <Knop type="submit" className="w-full" disabled={bezig}>
        {bezig ? "Bezig…" : "Inloggen"}
      </Knop>
    </form>
  );
}
