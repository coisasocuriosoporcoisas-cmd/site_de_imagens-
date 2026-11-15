import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authorizeLocalAdminApi } from "@/lib/local-auth";
import { imageFilePath, mutateGallery, recordAudit } from "@/lib/local-gallery";
import { imageFieldsSchema, normalizeTag } from "@/lib/validation";
import { sameOriginRequest } from "@/lib/security";
import { logServerError } from "@/lib/server-logging";

type Props = { params: Promise<{ id: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function redirectToAdmin(request: NextRequest, status: "success" | "error") {
  const url = new URL("/admin", request.url);
  url.searchParams.set("status", status);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest, { params }: Props) {
  if (!sameOriginRequest(request)) return NextResponse.json({ error: "Requisição inválida." }, { status: 403 });
  if (!await authorizeLocalAdminApi()) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await params;
  if (!uuid.test(id)) return NextResponse.json({ error: "Imagem não encontrada." }, { status: 404 });

  const form = await request.formData();
  const operation = form.get("operation");
  if (operation === "delete") {
    let removed: { local: boolean } | null = null;
    try {
      removed = await mutateGallery((gallery) => {
        const index = gallery.images.findIndex((image) => image.id === id);
        if (index < 0) return null;
        const [image] = gallery.images.splice(index, 1);
        recordAudit(gallery, {
          actor: "admin",
          action: "image.delete",
          entity_id: id,
        });
        return { local: !image.external_url };
      });
      if (removed?.local) {
        await Promise.all([
          rm(imageFilePath(id, "full"), { force: true }),
          rm(imageFilePath(id, "thumbnail"), { force: true }),
        ]);
      }
      return redirectToAdmin(request, removed ? "success" : "error");
    } catch (error) {
      logServerError("Local image delete failed", error);
      return redirectToAdmin(request, "error");
    }
  }

  const fields = imageFieldsSchema.safeParse({
    title: form.get("title"),
    description: form.get("description") || "",
    tags: String(form.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
  });
  if (!fields.success || !fields.data.title) return redirectToAdmin(request, "error");
  try {
    await mutateGallery((gallery) => {
      const image = gallery.images.find((item) => item.id === id);
      if (!image) return;
      const tags = [...new Set(fields.data.tags.map((tag) => normalizeTag(tag).name))];
      image.title = fields.data.title;
      image.description = fields.data.description || null;
      image.tags = tags;
      image.updated_at = new Date().toISOString();
      const slugs = new Set(gallery.tags.map((tag) => tag.slug));
      for (const name of tags) {
        const tag = normalizeTag(name);
        if (!slugs.has(tag.slug)) {
          gallery.tags.push({ id: randomUUID(), ...tag });
          slugs.add(tag.slug);
        }
      }
      recordAudit(gallery, {
        actor: "admin",
        action: "image.update",
        entity_id: id,
      });
    });
    return redirectToAdmin(request, "success");
  } catch (error) {
    logServerError("Local image update failed", error);
    return redirectToAdmin(request, "error");
  }
}
