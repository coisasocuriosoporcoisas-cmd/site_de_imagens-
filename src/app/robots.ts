import type { MetadataRoute } from "next";
import { getAdminLoginPath } from "@/lib/runtime-config";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api/admin", getAdminLoginPath()] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
