"use client";

import { useEffect } from "react";

/**
 * Registreert de service worker. Zonder dit is de app niet installeerbaar op een
 * handterminal en start hij elke keer via de browser in plaats van als app.
 *
 * Alleen in productie: in ontwikkeling zou een cachende worker je wijzigingen
 * verbergen en dan zoek je een uur naar een bug die er niet is.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* Geen service worker is vervelend, geen reden om de app te breken. */
    });
  }, []);

  return null;
}
