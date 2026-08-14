"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

/**
 * Scanveld. De meeste magazijnscanners zijn keyboard-wedge: ze typen de barcode
 * en drukken Enter. Daarom is dit gewoon een tekstveld met Enter-afhandeling —
 * betrouwbaarder dan camera-scanning en werkt met élke scanner.
 *
 * `autoFocus` claimt de focus zodra het veld aan de beurt is, zodat de
 * medewerker kan scannen zonder eerst te tikken. Handmatig typen blijft mogelijk
 * voor wanneer een label onleesbaar is.
 */
export function ScanVeld({
  label,
  waarde,
  onWaarde,
  onScan,
  placeholder,
  actief = true,
  klaar = false,
  hint,
}: {
  label: string;
  waarde: string;
  onWaarde: (v: string) => void;
  onScan: (v: string) => void;
  placeholder?: string;
  actief?: boolean;
  klaar?: boolean;
  hint?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (actief && !klaar) ref.current?.focus();
  }, [actief, klaar]);

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-sm font-medium text-slate">{label}</span>
        {klaar && <Icon name="vink" size={16} className="text-ok" />}
      </div>
      <div className="relative">
        <input
          ref={ref}
          data-scan
          value={waarde}
          placeholder={placeholder}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onWaarde(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const v = waarde.trim();
            if (v) onScan(v);
          }}
          className={cn(
            "w-full min-h-tap rounded-lg border-2 bg-white px-3 pr-11 text-lg",
            "focus:outline-none focus:ring-2 focus:ring-navy/20",
            klaar ? "border-ok bg-ok-50" : "border-navy-100 focus:border-navy"
          )}
        />
        <Icon
          name="scan"
          size={22}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate/50"
        />
      </div>
      {hint && <p className="mt-1 text-xs text-slate">{hint}</p>}
    </div>
  );
}
