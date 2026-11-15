import Link from "next/link";
import { ImageManager } from "@/components/image-manager";
import { toGalleryImage, type GalleryImage } from "@/lib/gallery";
import { getMaxUploadMb } from "@/lib/upload-limits";
import { readGallery } from "@/lib/local-gallery";
import { requireLocalAdminPage } from "@/lib/local-auth";
import { beginTotpSetup, confirmTotpSetup, disableTotp, logout } from "@/app/admin/actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ page?: string; status?: string; count?: string; reason?: string; mfa?: string }> }) {
  await requireLocalAdminPage();
  const params = await searchParams;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const gallery = await readGallery();
  const images = gallery.images.map(toGalleryImage).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const pageSize = 50;
  const pagedImages = images.slice((page - 1) * pageSize, page * pageSize);
  const tags = gallery.tags;
  const status = params.status;
  const mfaStatus = params.mfa;
  const setupUri = gallery.totp_pending_secret
    ? `otpauth://totp/lum-admin?secret=${gallery.totp_pending_secret}&issuer=lum&algorithm=SHA1&digits=6&period=30`
    : null;
  return <main className="management-shell">
    <header className="management-header">
      <div><Link className="brand" href="/">lum<span className="brand-mark">.</span></Link><p className="status-message">Área de gerenciamento</p></div>
      <form action={logout}><button className="quiet-button" type="submit">Sair</button></form>
    </header>
    {status === "success" && <p className="status-message" role="status">Importação concluída. {params.count ?? ""} imagens agora aparecem na galeria.</p>}
    {status === "error" && <p className="status-message" role="alert">
      {params.reason === "too-large" ? `Arquivo acima do limite local de ${getMaxUploadMb()} MB por imagem.`
        : params.reason === "invalid-type" ? "Tipo inválido. Use JPEG, PNG, WebP ou GIF."
          : params.reason === "invalid-url" ? "Use somente URLs HTTPS públicas e válidas."
            : params.reason === "too-many" ? "Importe até 50 itens por vez."
              : params.reason === "empty" ? "Selecione ao menos um arquivo ou link."
                : "Não foi possível concluir a importação. Confira os dados e tente novamente."}
    </p>}
    <ImageManager images={pagedImages as GalleryImage[]} tags={tags} maxUploadMb={getMaxUploadMb()}/>
    <section className="panel" style={{ marginTop: 22 }}>
      <h2>Autenticação em duas etapas</h2>
      {gallery.totp_secret ? <>
        <p>Autenticador TOTP ativo.</p>
        <form action={disableTotp}><button className="quiet-button" type="submit">Desativar e encerrar sessão</button></form>
      </> : setupUri ? <>
        <p>Adicione esta chave ao aplicativo autenticador e confirme um código de seis dígitos.</p>
        <code style={{ overflowWrap: "anywhere" }}>{gallery.totp_pending_secret}</code>
        <p className="status-message">{setupUri}</p>
        <form action={confirmTotpSetup} className="form-grid">
          <label>Código TOTP<input autoComplete="one-time-code" inputMode="numeric" name="code" pattern="[0-9]{6}" required maxLength={6}/></label>
          <button className="primary-button" type="submit">Ativar TOTP</button>
        </form>
        {mfaStatus === "error" && <p role="alert">Código inválido.</p>}
      </> : <form action={beginTotpSetup}><button className="quiet-button" type="submit">Configurar autenticador TOTP</button></form>}
      {mfaStatus === "enabled" && <p role="status">Autenticação em duas etapas ativada.</p>}
    </section>
    {images.length > pageSize && <nav className="pagination">
      {page > 1 && <Link className="quiet-button" href={`/admin?page=${page - 1}`}>Anterior</Link>}
      <span>Página {page} de {Math.ceil(images.length / pageSize)}</span>
      {page * pageSize < images.length && <Link className="quiet-button" href={`/admin?page=${page + 1}`}>Próxima</Link>}
    </nav>}
  </main>;
}
