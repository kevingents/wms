import type { Config } from "tailwindcss";

/**
 * GENTS huisstijl-tokens — gelijk aan storeportal_next, zodat WMS en portal
 * visueel één systeem blijven.
 *   navy  #0a1f33 — primair (topbar, knoppen, headings)
 *   slate #3a4a5a — secundaire tekst
 *   cream #f5f5f2 — paginabackground
 *
 * Extra t.o.v. de portal: `scan`-tokens. Het magazijn werkt met handschoenen op
 * een klein scherm, dus raakvlakken zijn groter en de statuskleuren feller.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#0a1f33",
          50: "#eef2f6",
          100: "#d4dde6",
          600: "#13314d",
          700: "#0e2740",
          800: "#0a1f33",
          900: "#071521",
        },
        slate: { DEFAULT: "#3a4a5a" },
        cream: { DEFAULT: "#f5f5f2" },
        ok: { DEFAULT: "#15803d", 50: "#f0fdf4", 100: "#dcfce7" },
        warn: { DEFAULT: "#b45309", 50: "#fffbeb", 100: "#fef3c7" },
        bad: { DEFAULT: "#b91c1c", 50: "#fef2f2", 100: "#fee2e2" },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(10 31 51 / 0.04), 0 1px 3px 0 rgb(10 31 51 / 0.08)",
      },
      minHeight: { tap: "3rem" },
    },
  },
  plugins: [],
};

export default config;
