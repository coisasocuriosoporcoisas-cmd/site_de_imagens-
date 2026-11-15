export default function Loading() {
  return <main className="page-shell" aria-label="Carregando galeria">
    <header className="topbar"><div className="skeleton" style={{ height: 28, width: 90 }}/><div className="skeleton" style={{ height: 46, flex: 1 }}/></header>
    <div className="skeleton" style={{ height: 150, margin: "36px 0 24px", maxWidth: 700 }}/>
    <section className="masonry">
      {["s1","s2","s3","s4","s5","s6","s7","s8","s9","s10"].map((key, index) => <div className="skeleton" key={key} style={{ height: 180 + (index % 4) * 55, marginBottom: 18 }}/>)}
    </section>
  </main>;
}
