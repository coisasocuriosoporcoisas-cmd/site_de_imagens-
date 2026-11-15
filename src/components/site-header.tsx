import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader({ query = "" }: { query?: string }) {
  return <header className="topbar">
    <Link className="brand" href="/">lum<span className="brand-mark">.</span></Link>
    <search className="search-box">
      <form action="/" style={{ display: "flex", width: "100%" }}>
      <input aria-label="Buscar imagens" name="q" placeholder="Busque imagens, ideias e inspirações" defaultValue={query} />
      {query ? <Link aria-label="Limpar busca" href="/">×</Link> : <span aria-hidden="true">⌕</span>}
      </form>
    </search>
    <div className="top-actions">
      <ThemeToggle />
    </div>
  </header>;
}
