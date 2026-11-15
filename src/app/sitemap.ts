import type { MetadataRoute } from "next";
import { listGalleryImages } from "@/lib/gallery";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const images = await listGalleryImages();
  return [
    { url: base, lastModified: new Date() },
    ...images.map((image) => ({ url: `${base}/pin/${image.id}`, lastModified: new Date(image.created_at) })),
  ];
}
