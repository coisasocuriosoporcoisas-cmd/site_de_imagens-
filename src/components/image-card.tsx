import Image from "next/image";
import Link from "next/link";
import type { GalleryImage } from "@/lib/gallery";
import { imageTags, publicImageUrl } from "@/lib/gallery";

export function ImageCard({ image, priority = false }: { image: GalleryImage; priority?: boolean }) {
  const tags = imageTags(image);
  return <article className="image-card">
    <Link href={`/pin/${image.id}`} aria-label={`Ver imagem: ${image.title}`}>
      <Image
        src={publicImageUrl(image.thumbnail_path)}
        alt={image.title}
        width={image.width}
        height={image.height}
        sizes="(max-width: 639px) 48vw, (max-width: 959px) 31vw, (max-width: 1279px) 23vw, 18vw"
        priority={priority}
      />
      <h2 className="image-card-title">{image.title}</h2>
      {tags.length > 0 && <p className="image-card-tags">{tags.map((tag) => tag.name).join(" · ")}</p>}
    </Link>
  </article>;
}
