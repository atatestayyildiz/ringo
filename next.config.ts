import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  async headers() {
    return [
      {
        // Sıfırlama kodu URL'de gelir: dışarıya Referer sızmasın, sayfa önbelleğe alınmasın.
        source: "/sifre-sifirla/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
