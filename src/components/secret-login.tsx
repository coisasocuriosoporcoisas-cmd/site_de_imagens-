import Link from "next/link";
import { login } from "@/app/admin/actions";

export async function SecretLogin({ searchParams, totpRequired }: {
  searchParams: Promise<{ status?: string; minutes?: string }>;
  totpRequired: boolean;
}) {
  const { status, minutes } = await searchParams;
  const minMinutes = Math.max(1, Number.parseInt(minutes ?? "15", 10) || 15);
  return <main className="page-shell">
    <header className="topbar"><Link className="brand" href="/">lum<span className="brand-mark">.</span></Link></header>
    <section className="panel secret-entry">
      <span className="eyebrow">Área restrita</span>
      <h1>Entrar</h1>
      <form action={login} className="form-grid">
        <label>Usuário<input autoComplete="username" name="username" required maxLength={64}/></label>
        <label>Senha<input autoComplete="current-password" name="password" type="password" required maxLength={128}/></label>
        {totpRequired && <label>Código do aplicativo autenticador<input autoComplete="one-time-code" inputMode="numeric" name="totp" pattern="[0-9]{6}" required maxLength={6}/></label>}
        {status === "invalid" && <p className="status-message" role="alert">Usuário ou senha inválidos.</p>}
        {status === "blocked" && <p className="status-message" role="alert">Muitas tentativas, tente novamente em {minMinutes} minutos.</p>}
        {status === "unavailable" && <p className="status-message" role="alert">Serviço temporariamente indisponível, tente novamente mais tarde.</p>}
        <button className="primary-button" type="submit">Entrar</button>
      </form>
      <small className="status-message">Acesso local do proprietário.</small>
    </section>
  </main>;
}
