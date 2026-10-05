import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ringo",
    short_name: "Ringo",
    description: "Müşteri takip ve arama listesi",
    start_url: "/bugun",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#fb521e",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
