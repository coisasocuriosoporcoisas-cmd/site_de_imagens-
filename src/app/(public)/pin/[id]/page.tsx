import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { ImageCard } from "@/components/image-card";
import { findGalleryImage, getSimilarImages, imageTags, publicImageUrl } from "@/lib/gallery";

type Props = { params: Promise<{ id: string }> };

async function findImage(id: string) {
  return findGalleryImage(id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const image = await findImage(id);
  if (!image) return { title: "Imagem não encontrada" };
  const url = publicImageUrl(image.storage_path);
  return {
    title: image.title,
    description: image.description ?? `Veja ${image.title} na galeria lum.`,
    openGraph: { type: "website", title: image.title, description: image.description ?? undefined, images: [{ url, width: image.width, height: image.height, alt: image.title }] },
    twitter: { card: "summary_large_image", title: image.title, images: [url] },
  };
}

export default async function PinDetail({ params }: Props) {
  const { id } = await params;
  const image = await findImage(id);
  if (!image) notFound();
  const similar = await getSimilarImages(image);
  const tags = imageTags(image);
  return <main className="page-shell">
    <SiteHeader/>
    <Link className="quiet-button" href="/">← Voltar à galeria</Link>
    <article className="detail-layout">
      <Image className="detail-image" src={publicImageUrl(image.storage_path)} alt={image.title} width={image.width} height={image.height} priority sizes="(max-width: 700px) 100vw, 65vw"/>
      <div className="detail-copy">
        <h1>{image.title}</h1>
        {image.description && <p>{image.description}</p>}
        <div className="tag-row">{tags.map((item) => <Link className="tag-pill" href={`/?tag=${encodeURIComponent(item.slug)}`} key={item.slug}>{item.name}</Link>)}</div>
        <a className="primary-button" href={`/api/download/${image.id}`}>Baixar imagem</a>
      </div>
    </article>
    {similar.length > 0 && <>
      <h2 className="section-title">Imagens semelhantes</h2>
      <section className="masonry" aria-label="Imagens semelhantes">{similar.map((item) => <ImageCard image={item} key={item.id}/>)}</section>
    </>}
  </main>;
}
