import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import sharp, { type OutputInfo } from "sharp";
import { NextResponse, type NextRequest } from "next/server";
import { authorizeLocalAdminApi } from "@/lib/local-auth";
import { imageFilePath, mutateGallery, recordAudit, type LocalImage } from "@/lib/local-gallery";
import { hasImageSignature, imageFieldsSchema, normalizeTag } from "@/lib/validation";
import { getMaxUploadMb, MAX_PROCESSED_IMAGE_BYTES } from "@/lib/upload-limits";
import { logServerError } from "@/lib/server-logging";
import { sameOriginRequest } from "@/lib/security";
import { isPublicHttpsImageUrl } from "@/lib/public-image-url";

export const runtime = "nodejs";

function pageRedirect(request: NextRequest, status: "success" | "error", count = 0, reason?: string) {
  const url = new URL("/admin", request.url);
  url.searchParams.set("status", status);
  if (status === "success") url.searchParams.set("count", String(count));
  if (reason) url.searchParams.set("reason", reason);
  return NextResponse.redirect(url, 303);
}

function normalizedTags(value: string) {
  return [...new Set(value.split(",").map((name) => normalizeTag(name).name).filter(Boolean))].slice(0, 20);
}

async function saveLocalFile(file: File, id: string, title: string, description: string | null, tags: string[]) {
  if (file.size < 1 || file.size > getMaxUploadMb() * 1024 * 1024) throw new UploadError("FILE_TOO_LARGE");
  const input = Buffer.from(await file.arrayBuffer());
  if (!hasImageSignature(input)) throw new UploadError("INVALID_TYPE");

  let processed: { data: Buffer; info: OutputInfo };
  let thumbnail: Buffer;
  try {
    const metadata = await sharp(input, { animated: true, limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.width || !metadata.height || !["jpeg", "png", "webp", "gif"].includes(metadata.format ?? "")) {
      throw new Error("Unsupported image format");
    }
    processed = await sharp(input, { animated: true, limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84, effort: 5 })
      .toBuffer({ resolveWithObject: true });
    thumbnail = await sharp(processed.data, { animated: true })
      .resize({ width: 720, height: 720, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 })
      .toBuffer();
  } catch (error) {
    logServerError("Local image decode failed", error);
    throw new UploadError("INVALID_TYPE");
  }
  if (processed.data.length > MAX_PROCESSED_IMAGE_BYTES || thumbnail.length > MAX_PROCESSED_IMAGE_BYTES) {
    throw new UploadError("FILE_TOO_LARGE");
  }

  try {
    await Promise.all([
      writeFile(imageFilePath(id, "full"), processed.data, { flag: "wx", mode: 0o600 }),
      writeFile(imageFilePath(id, "thumbnail"), thumbnail, { flag: "wx", mode: 0o600 }),
    ]);
  } catch (error) {
    await Promise.all([
      rm(imageFilePath(id, "full"), { force: true }),
      rm(imageFilePath(id, "thumbnail"), { force: true }),
    ]);
    throw error;
  }
  const now = new Date().toISOString();
  return {
    id,
    title: title.trim() || file.name.replace(/\.[^.]+$/, "").slice(0, 160) || "Imagem sem título",
    description,
    storage_path: `${id}-full.webp`,
    thumbnail_path: `${id}-thumbnail.webp`,
    width: processed.info.width,
    height: processed.info.height,
    created_at: now,
    updated_at: now,
    tags,
  };
}

class UploadError extends Error {
  constructor(readonly code: "FILE_TOO_LARGE" | "INVALID_TYPE" | "INVALID_URL") {
    super(code);
  }
}

export async function POST(request: NextRequest) {
  if (!sameOriginRequest(request)) return NextResponse.json({ error: "Requisição inválida." }, { status: 403 });
  if (!await authorizeLocalAdminApi()) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const savedIds: string[] = [];
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File && entry.size > 0);
    const urls = String(form.get("imageUrls") ?? "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const itemCount = files.length + urls.length;
    if (itemCount === 0) return pageRedirect(request, "error", 0, "empty");
    if (itemCount > 50) return pageRedirect(request, "error", 0, "too-many");

    const tagsInput = String(form.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
    const fields = imageFieldsSchema.safeParse({
      title: form.get("title") || "",
      description: form.get("description") || "",
      tags: tagsInput,
    });
    if (!fields.success) return pageRedirect(request, "error", 0, "invalid-fields");
    const tags = normalizedTags(tagsInput.join(","));
    const description = fields.data.description || null;
    const newImages: LocalImage[] = [];

    for (const file of files) {
      const id = randomUUID();
      const record = await saveLocalFile(file, id, fields.data.title, description, tags);
      savedIds.push(id);
      newImages.push(record);
    }

    for (const imageUrl of urls) {
      const validatedUrl = isPublicHttpsImageUrl(imageUrl);
      if (!validatedUrl) throw new UploadError("INVALID_URL");
      const pathname = new URL(validatedUrl).pathname;
      const fileTitle = decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) ?? "Imagem")
        .replace(/\.[^.]+$/, "").slice(0, 160);
      const now = new Date().toISOString();
      newImages.push({
        id: randomUUID(),
        title: fields.data.title || fileTitle || "Imagem sem título",
        description,
        external_url: validatedUrl,
        width: 1200,
        height: 900,
        created_at: now,
        updated_at: now,
        tags,
      });
    }

    await mutateGallery((gallery) => {
      gallery.images.unshift(...newImages);
      const existing = new Set(gallery.tags.map((tag) => tag.slug));
      for (const name of tags) {
        const tag = normalizeTag(name);
        if (!existing.has(tag.slug)) {
          gallery.tags.push({ id: randomUUID(), ...tag });
          existing.add(tag.slug);
        }
      }
      for (const image of newImages) {
        recordAudit(gallery, {
          actor: "admin",
          action: "image.create",
          entity_id: image.id,
        });
      }
    });
    return pageRedirect(request, "success", newImages.length);
  } catch (error) {
    await Promise.all(savedIds.flatMap((id) => [
      rm(imageFilePath(id, "full"), { force: true }),
      rm(imageFilePath(id, "thumbnail"), { force: true }),
    ]));
    if (error instanceof UploadError) {
      const reason = error.code === "FILE_TOO_LARGE" ? "too-large" : error.code === "INVALID_URL" ? "invalid-url" : "invalid-type";
      return pageRedirect(request, "error", 0, reason);
    }
    logServerError("Local gallery import failed", error);
    return pageRedirect(request, "error");
  }
}
