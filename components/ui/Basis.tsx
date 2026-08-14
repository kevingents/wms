import { cn } from "@/lib/cn";

/**
 * Basiscomponenten. Bewust groot en contrastrijk: dit draait op een scanner of
 * tablet in het magazijn, vaak met handschoenen aan. Raakvlakken zijn minimaal
 * 48px (min-h-tap) en primaire acties zijn full-width.
 */

export function Kaart({
  titel,
  actie,
  className,
  children,
}: {
  titel?: string;
  actie?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-navy-100 bg-white p-4 shadow-card sm:p-5",
        className
      )}
    >
      {(titel || actie) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {titel && (
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate">
              {titel}
            </h2>
          )}
          {actie}
        </header>
      )}
      {children}
    </section>
  );
}

export function Knop({
  variant = "primair",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primair" | "secundair" | "gevaar" | "stil";
}) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex min-h-tap items-center justify-center gap-2 rounded-lg px-4 text-base font-semibold",
        "transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primair" && "bg-navy text-white hover:bg-navy-600",
        variant === "secundair" &&
          "border border-navy-100 bg-white text-navy hover:bg-navy-50",
        variant === "gevaar" && "bg-bad text-white hover:bg-bad/90",
        variant === "stil" && "text-slate hover:bg-navy-50",
        className
      )}
    />
  );
}

export function Veld({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-sm font-medium text-slate">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate/80">{hint}</span>}
    </label>
  );
}

export const invoerClasses =
  "w-full min-h-tap rounded-lg border border-navy-100 bg-white px-3 text-lg " +
  "text-navy placeholder:text-slate/50 focus:border-navy focus:outline-none " +
  "focus:ring-2 focus:ring-navy/20";

export function Melding({
  soort = "info",
  children,
}: {
  soort?: "info" | "ok" | "warn" | "bad";
  children: React.ReactNode;
}) {
  return (
    <div
      role={soort === "bad" ? "alert" : "status"}
      className={cn(
        "rounded-lg px-3 py-2 text-sm font-medium",
        soort === "info" && "bg-navy-50 text-navy",
        soort === "ok" && "bg-ok-100 text-ok",
        soort === "warn" && "bg-warn-100 text-warn",
        soort === "bad" && "bg-bad-100 text-bad"
      )}
    >
      {children}
    </div>
  );
}

export function Kental({
  label,
  waarde,
  toelichting,
  soort = "neutraal",
}: {
  label: string;
  waarde: string | number;
  toelichting?: string;
  soort?: "neutraal" | "ok" | "warn" | "bad";
}) {
  return (
    <div className="rounded-xl border border-navy-100 bg-white p-4 shadow-card">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-3xl font-bold tabular-nums",
          soort === "neutraal" && "text-navy",
          soort === "ok" && "text-ok",
          soort === "warn" && "text-warn",
          soort === "bad" && "text-bad"
        )}
      >
        {waarde}
      </div>
      {toelichting && <div className="mt-1 text-xs text-slate">{toelichting}</div>}
    </div>
  );
}

export function LeegState({ tekst }: { tekst: string }) {
  return (
    <p className="rounded-lg border border-dashed border-navy-100 px-4 py-8 text-center text-sm text-slate">
      {tekst}
    </p>
  );
}
