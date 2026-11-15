import { NextResponse, type NextRequest } from "next/server";
import { authorizeLocalAdminApi } from "@/lib/local-auth";
import { mutateGallery, recordAudit } from "@/lib/local-gallery";
import { normalizeTag } from "@/lib/validation";
import { sameOriginRequest } from "@/lib/security";

function redirectToAdmin(request: NextRequest, status: "success" | "error") {
  const url = new URL("/admin", request.url);
  url.searchParams.set("status", status);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  if (!sameOriginRequest(request)) return NextResponse.json({ error: "Requisição inválida." }, { status: 403 });
  if (!await authorizeLocalAdminApi()) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const form = await request.formData();
  const operation = form.get("operation");
  const sourceId = String(form.get("sourceId") ?? "");
  const targetId = String(form.get("targetId") ?? "");
  const newName = String(form.get("newName") ?? "");
  if (!["rename", "merge", "delete"].includes(String(operation))) return redirectToAdmin(request, "error");
  try {
    const success = await mutateGallery((gallery) => {
      const source = gallery.tags.find((tag) => tag.id === sourceId);
      if (!source) return false;
      if (operation === "rename") {
        const normalized = normalizeTag(newName);
        if (!normalized.name || !normalized.slug || gallery.tags.some((tag) => tag.slug === normalized.slug && tag.id !== source.id)) return false;
        const oldSlug = source.slug;
        source.name = normalized.name;
        source.slug = normalized.slug;
        for (const image of gallery.images) {
          image.tags = image.tags.map((name) => normalizeTag(name).slug === oldSlug ? normalized.name : name);
        }
      } else if (operation === "merge") {
        const target = gallery.tags.find((tag) => tag.id === targetId);
        if (!target || target.id === source.id) return false;
        for (const image of gallery.images) {
          if (image.tags.some((name) => normalizeTag(name).slug === source.slug)) {
            image.tags = [...new Set([...image.tags.filter((name) => normalizeTag(name).slug !== source.slug), target.name])];
          }
        }
        gallery.tags = gallery.tags.filter((tag) => tag.id !== source.id);
      } else {
        if (gallery.images.some((image) => image.tags.some((name) => normalizeTag(name).slug === source.slug))) return false;
        gallery.tags = gallery.tags.filter((tag) => tag.id !== source.id);
      }
      recordAudit(gallery, {
        actor: "admin",
        action: operation === "rename" ? "tag.update" : operation === "merge" ? "tag.merge" : "tag.delete",
      });
      return true;
    });
    return redirectToAdmin(request, success ? "success" : "error");
  } catch {
    return redirectToAdmin(request, "error");
  }
}
