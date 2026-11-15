import { readFile } from "node:fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import { imageFilePath, readGallery } from "@/lib/local-gallery";

type Props = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: Props) {
  const { id } = await params;
  if (!uuid.test(id)) return new NextResponse(null, { status: 404 });
  const variant = request.nextUrl.searchParams.get("variant") === "thumbnail" ? "thumbnail" : "full";
  const gallery = await readGallery();
  const image = gallery.images.find((item) => item.id === id);
  if (!image || image.external_url) return new NextResponse(null, { status: 404 });
  try {
    const buffer = await readFile(imageFilePath(id, variant));
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Length": String(buffer.length),
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
