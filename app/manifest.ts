import type { MetadataRoute } from "next";

/**
 * PWA-manifest. Hiermee installeert de handterminal het WMS als echte app:
 * eigen icoon op het startscherm, volledig scherm zonder browserbalk, en een
 * vaste startpagina.
 *
 * `start_url` is /terminal en niet /: op een handscanner van 5 inch wil je het
 * tegel-menu, niet het dashboard dat voor een bureaublad is gemaakt.
 *
 * `orientation: portrait` omdat een handterminal in één hand ligt; draaien
 * tijdens het scannen is alleen maar lastig.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GENTS WMS",
    short_name: "WMS",
    description: "Magazijnbeheer — scannen, picken, tellen",
    start_url: "/terminal",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a1f33",
    theme_color: "#0a1f33",
    lang: "nl",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
