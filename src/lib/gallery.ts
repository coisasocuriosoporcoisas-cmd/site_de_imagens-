import { readGallery, type LocalImage } from "@/lib/local-gallery";

export type GalleryImage = {
  id: string;
  title: string;
  description: string | null;
  storage_path: string;
  thumbnail_path: string;
  width: number;
  height: number;
  created_at: string;
  image_tags: { tags: { name: string; slug: string } | null }[];
};

export const PAGE_SIZE = 30;

export function toGalleryImage(image: LocalImage): GalleryImage {
  const imagePath = image.external_url ?? `/api/gallery/image/${image.id}?variant=full`;
  const thumbnailPath = image.external_url ?? `/api/gallery/image/${image.id}?variant=thumbnail`;
  return {
    id: image.id,
    title: image.title,
    description: image.description,
    storage_path: imagePath,
    thumbnail_path: thumbnailPath,
    width: image.width,
    height: image.height,
    created_at: image.created_at,
    image_tags: image.tags.map((name) => ({
      tags: { name, slug: name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") },
    })),
  };
}

export function publicImageUrl(path: string) {
  if (path.startsWith("/") || /^https:\/\//i.test(path)) return path;
  throw new Error("Unrecognized local image URL");
}

export function imageTags(image: GalleryImage) {
  return image.image_tags.flatMap(({ tags }) => tags ? [tags] : []);
}

export async function listGalleryImages() {
  const gallery = await readGallery();
  return gallery.images
    .map(toGalleryImage)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getSimilarImages(image: GalleryImage): Promise<GalleryImage[]> {
  const sharedTags = new Set(imageTags(image).map((tag) => tag.slug));
  if (!sharedTags.size) return [];
  const gallery = await readGallery();
  return gallery.images
    .filter((candidate) => candidate.id !== image.id)
    .map(toGalleryImage)
    .map((candidate) => ({
      image: candidate,
      count: imageTags(candidate).filter((tag) => sharedTags.has(tag.slug)).length,
    }))
    .filter((candidate) => candidate.count > 0)
    .sort((a, b) => b.count - a.count || b.image.created_at.localeCompare(a.image.created_at))
    .slice(0, 24)
    .map((candidate) => candidate.image);
}

export async function findGalleryImage(id: string) {
  const gallery = await readGallery();
  const image = gallery.images.find((item) => item.id === id);
  return image ? toGalleryImage(image) : null;
}

export async function listGalleryTags() {
  const gallery = await readGallery();
  return gallery.tags;
}
