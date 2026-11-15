import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ImageCard } from "@/components/image-card";
import { listGalleryImages, listGalleryTags, PAGE_SIZE } from "@/lib/gallery";

export const metadata: Metadata = { title: "Inspiração visual para todos os dias" };

type SearchParams = Promise<{ q?: string; tag?: string; page?: string }>;

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const query = (params.q ?? "").trim().slice(0, 100);
  const tag = (params.tag ?? "").trim().slice(0, 80);
  const page = Math.max(1, Math.min(1000, Number.parseInt(params.page ?? "1", 10) || 1));
  const [allImages, tags] = await Promise.all([listGalleryImages(), listGalleryTags()]);
  const filteredImages = allImages.filter((image) =>
    (!query || image.title.toLowerCase().includes(query.toLowerCase())) &&
    (!tag || image.image_tags.some(({ tags: item }) => item?.slug === tag)),
  );
  const images = filteredImages.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.ceil(filteredImages.length / PAGE_SIZE);
  return <main className="page-shell">
    <SiteHeader query={query}/>
    <section className="hero">
      <span className="eyebrow">Coleção aberta</span>
      <h1>Ideias que merecem ser vistas.</h1>
      <p>Uma galeria independente para encontrar sua próxima inspiração.</p>
    </section>
    <nav className="tag-row" aria-label="Filtrar por tag">
      {tag && <Link className="tag-pill" href="/">Todas as imagens ×</Link>}
      {(tags ?? []).map((item) => <Link className="tag-pill" href={`/?tag=${encodeURIComponent(item.slug)}`} key={item.slug} aria-current={tag === item.slug ? "page" : undefined}>{item.name}</Link>)}
    </nav>
    {images.length ? <section className="masonry" aria-label="Galeria de imagens">
        {images.map((image, index) => <ImageCard image={image} key={image.id} priority={index < 5}/>)}
      </section> : <div className="empty-state"><h2>Nenhuma imagem encontrada</h2><p>Tente outra busca ou volte mais tarde.</p></div>}
    {totalPages > 1 && <nav className="pagination" aria-label="Paginação">
      {page > 1 && <Link className="quiet-button" href={page === 2 ? `/?q=${encodeURIComponent(query)}&tag=${encodeURIComponent(tag)}` : `/?q=${encodeURIComponent(query)}&tag=${encodeURIComponent(tag)}&page=${page - 1}`}>Anterior</Link>}
      <span>Página {page} de {totalPages}</span>
      {page < totalPages && <Link className="quiet-button" href={`/?q=${encodeURIComponent(query)}&tag=${encodeURIComponent(tag)}&page=${page + 1}`}>Próxima</Link>}
    </nav>}
    <footer className="pagination"><small>lum. — uma galeria para inspirar</small></footer>
  </main>;
}
