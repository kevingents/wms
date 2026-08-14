import { ImageResponse } from "next/og";

/**
 * App-icoon, gegenereerd door Next.js zelf (next/og). Zo hoeft er geen binair
 * bestand in de repo en blijft het icoon meebewegen met de huisstijl.
 * Wordt ook door de PWA-manifest gebruikt, zodat de handterminal een echt
 * app-icoon op het startscherm krijgt.
 */

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a1f33",
          color: "#ffffff",
          fontSize: 150,
          fontWeight: 700,
          letterSpacing: -6,
        }}
      >
        <div style={{ display: "flex" }}>WMS</div>
        <div style={{ display: "flex", fontSize: 54, letterSpacing: 8, opacity: 0.6 }}>
          GENTS
        </div>
      </div>
    ),
    size
  );
}
