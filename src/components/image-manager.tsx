import Image from "next/image";
import type { GalleryImage } from "@/lib/gallery";

type Tag = { id: string; name: string; slug: string };

export function ImageManager({ images, tags, maxUploadMb }: { images: GalleryImage[]; tags: Tag[]; maxUploadMb: number }) {
  return <>
    <section className="panel">
      <div className="management-header"><h1>Adicionar imagens</h1></div>
      <p className="status-message">Selecione várias imagens ou cole URLs HTTPS, uma por linha. Até 50 itens por importação.</p>
      <form action="/api/admin/images" className="form-grid" encType="multipart/form-data" method="post">
        <fieldset className="drop-zone">
          <label>Arquivos (JPEG, PNG, WebP ou GIF; até {maxUploadMb} MB cada)
            <input accept="image/jpeg,image/png,image/webp,image/gif" multiple name="files" type="file"/>
          </label>
        </fieldset>
        <label>Links de imagens (HTTPS, um por linha)<textarea name="imageUrls" placeholder="https://example.com/image.jpg"/></label>
        <label>Título (opcional; se vazio, usa o nome do arquivo/link)<input name="title" maxLength={160}/></label>
        <label>Descrição (opcional)<textarea name="description" maxLength={5000}/></label>
        <label>Tags (separadas por vírgula)
          <input list="existing-tags" name="tags" placeholder="paisagem, #meme"/>
          <datalist id="existing-tags">{tags.map((tag) => <option key={tag.id} value={tag.name}/>)}</datalist>
        </label>
        <button className="primary-button" type="submit">Importar imagens</button>
      </form>
    </section>
    <section aria-label="Imagens cadastradas" className="panel" style={{ marginTop: 22 }}>
      <h2>Imagens cadastradas ({images.length})</h2>
      {images.length ? <div className="management-list">{images.map((image) => <article className="management-row" key={image.id}>
        <Image src={image.thumbnail_path} alt="" width={66} height={66}/>
        <form action={`/api/admin/images/${image.id}`} className="form-grid" encType="application/x-www-form-urlencoded" method="post">
          <input name="title" aria-label="Título" defaultValue={image.title} maxLength={160} required/>
          <input name="description" aria-label="Descrição" defaultValue={image.description ?? ""} maxLength={5000}/>
          <input name="tags" aria-label="Tags separadas por vírgula" defaultValue={image.image_tags.flatMap(({ tags: item }) => item ? [item.name] : []).join(", ")} maxLength={1000}/>
          <div className="top-actions">
            <button className="quiet-button" name="operation" value="update" type="submit">Salvar</button>
            <button className="quiet-button" name="operation" value="delete" type="submit">Excluir</button>
          </div>
        </form>
      </article>)}</div> : <p className="status-message">Nenhuma imagem cadastrada ainda.</p>}
    </section>
    <section aria-label="Gerenciar tags" className="panel" style={{ marginTop: 22 }}>
      <h2>Gerenciar tags</h2>
      <form action="/api/admin/tags" className="form-grid" method="post">
        <label>Ação<select name="operation">
          <option value="rename">Renomear</option>
          <option value="merge">Mesclar</option>
          <option value="delete">Excluir tag sem uso</option>
        </select></label>
        <label>Tag de origem<select name="sourceId" required>
          {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
        </select></label>
        <label>Tag de destino ou novo nome<select name="targetId">
          <option value="">Não aplicável</option>
          {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
        </select></label>
        <label>Novo nome (renomear)<input name="newName" maxLength={50}/></label>
        <button className="quiet-button" type="submit">Aplicar</button>
      </form>
    </section>
  </>;
}
