import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: "standalone",
  allowedDevOrigins: ["26.137.210.160"],
  async headers() {
    const developmentScriptPolicy = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: `default-src 'self'; img-src 'self' data: https:; connect-src 'self'; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'${developmentScriptPolicy}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      ],
    }, {
      source: "/admin/:path*",
      headers: [
        { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      ],
    }, {
      source: "/api/admin/:path*",
      headers: [
        { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      ],
    }];
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
