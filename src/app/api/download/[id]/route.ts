import { readFile } from "node:fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import { findGalleryImage, publicImageUrl } from "@/lib/gallery";
import { imageFilePath } from "@/lib/local-gallery";
import { enforceRateLimit } from "@/lib/security";

type Props = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  if (!uuid.test(id)) return NextResponse.json({ error: "Imagem não encontrada." }, { status: 404 });
  if (!await enforceRateLimit(_request.headers, "download", 30, 60)) {
    return NextResponse.json({ error: "Muitos downloads. Tente novamente em breve." }, { status: 429 });
  }
  const image = await findGalleryImage(id);
  if (!image) return NextResponse.json({ error: "Imagem não encontrada." }, { status: 404 });
  if (/^https:\/\//i.test(image.storage_path)) {
    return NextResponse.redirect(publicImageUrl(image.storage_path), 302);
  }
  try {
    const file = await readFile(imageFilePath(id, "full"));
    return new NextResponse(file, {
      headers: {
        "Content-Type": "image/webp",
        "Content-Disposition": `attachment; filename="${id}.webp"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Download indisponível." }, { status: 404 });
  }
}
