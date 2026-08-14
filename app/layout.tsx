import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GENTS WMS",
  description: "Magazijnbeheer — voorraad per locatie",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /* Geen user-scaling: op een scanner leidt per ongeluk zoomen tot misklikken. */
  maximumScale: 1,
  themeColor: "#0a1f33",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
