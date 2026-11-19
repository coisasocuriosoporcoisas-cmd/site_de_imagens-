const themeKey = "gallery-theme";

function applyTheme() {
  const saved = localStorage.getItem(themeKey);
  const dark = saved === "dark" || (!saved && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function addThemeHandlers() {
  applyTheme();
  for (const button of document.querySelectorAll("[data-theme-toggle]")) {
    button.addEventListener("click", () => {
      const dark = document.documentElement.dataset.theme !== "dark";
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      localStorage.setItem(themeKey, dark ? "dark" : "light");
    });
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function imageCard(image) {
  const article = element("article", "image-card");
  const link = document.createElement("a");
  link.href = `/pin/${encodeURIComponent(image.id)}`;
  link.setAttribute("aria-label", `Ver imagem: ${image.title}`);
  const img = document.createElement("img");
  img.src = image.thumbnail_url;
  img.alt = image.title;
  img.width = image.width;
  img.height = image.height;
  img.loading = "lazy";
  img.decoding = "async";
  link.append(img, element("h2", "image-card-title", image.title));
  if (image.tags.length) link.append(element("p", "image-card-tags", image.tags.map((tag) => tag.name).join(" · ")));
  article.append(link);
  return article;
}

function currentParams() {
  const params = new URLSearchParams(location.search);
  return {
    q: (params.get("q") ?? "").trim().slice(0, 100),
    tag: (params.get("tag") ?? "").trim().slice(0, 80),
    page: Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1),
  };
}

function setQuery(params) {
  const url = new URL(location.href);
  for (const key of ["q", "tag", "page"]) url.searchParams.delete(key);
  if (params.q) url.searchParams.set("q", params.q);
  if (params.tag) url.searchParams.set("tag", params.tag);
  if (params.page > 1) url.searchParams.set("page", String(params.page));
  history.pushState({}, "", `${url.pathname}${url.search}`);
  return renderGallery();
}

function renderTags(tags, active) {
  const row = document.querySelector("#tag-row");
  row.replaceChildren();
  if (active) {
    const clear = element("a", "tag-pill", "Todas as imagens ×");
    clear.href = "/";
    clear.addEventListener("click", (event) => {
      event.preventDefault();
      const params = currentParams();
      setQuery({ ...params, tag: "", page: 1 });
    });
    row.append(clear);
  }
  for (const tag of tags) {
    const link = element("a", "tag-pill", tag.name);
    link.href = `/?tag=${encodeURIComponent(tag.slug)}`;
    if (tag.slug === active) link.setAttribute("aria-current", "page");
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const params = currentParams();
      setQuery({ ...params, tag: tag.slug, page: 1 });
    });
    row.append(link);
  }
}

function renderPagination(data, params) {
  const nav = document.querySelector("#pagination");
  nav.replaceChildren();
  if (data.totalPages <= 1) return;
  if (data.page > 1) {
    const previous = element("button", "quiet-button", "Anterior");
    previous.type = "button";
    previous.addEventListener("click", () => setQuery({ ...params, page: data.page - 1 }));
    nav.append(previous);
  }
  nav.append(element("span", "", `Página ${data.page} de ${data.totalPages}`));
  if (data.page < data.totalPages) {
    const next = element("button", "quiet-button", "Próxima");
    next.type = "button";
    next.addEventListener("click", () => setQuery({ ...params, page: data.page + 1 }));
    nav.append(next);
  }
}

async function renderGallery() {
  const gallery = document.querySelector("#gallery");
  if (!gallery) return;
  const params = currentParams();
  const search = document.querySelector("#search-input");
  search.value = params.q;
  gallery.replaceChildren(element("p", "loading", "Carregando imagens…"));
  const query = new URLSearchParams({ q: params.q, tag: params.tag, page: String(params.page) });
  try {
    const response = await fetch(`/api/gallery?${query}`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Falha ao carregar galeria");
    const data = await response.json();
    renderTags(data.tags, params.tag);
    gallery.replaceChildren();
    if (!data.images.length) {
      const empty = element("div", "empty-state");
      empty.append(element("h2", "", "Nenhuma imagem encontrada"), element("p", "", "Tente outra busca ou volte mais tarde."));
      gallery.append(empty);
    } else {
      for (const image of data.images) gallery.append(imageCard(image));
    }
    renderPagination(data, params);
  } catch {
    gallery.replaceChildren(element("p", "empty-state error-message", "Não foi possível carregar a galeria. Tente novamente."));
  }
}

async function renderPin() {
  const detail = document.querySelector("#pin-detail");
  if (!detail) return;
  const id = location.pathname.split("/")[2] ?? "";
  detail.replaceChildren(element("p", "loading", "Carregando imagem…"));
  try {
    const response = await fetch(`/api/gallery/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error("Imagem não encontrada");
    const data = await response.json();
    const image = data.image;
    document.title = `${image.title} — lum.`;
    const img = document.createElement("img");
    img.className = "detail-image";
    img.src = image.image_url;
    img.alt = image.title;
    img.width = image.width;
    img.height = image.height;
    img.fetchPriority = "high";
    const copy = element("div", "detail-copy");
    copy.append(element("h1", "", image.title));
    if (image.description) copy.append(element("p", "", image.description));
    const tags = element("div", "tag-row");
    for (const tag of image.tags) {
      const link = element("a", "tag-pill", tag.name);
      link.href = `/?tag=${encodeURIComponent(tag.slug)}`;
      tags.append(link);
    }
    const download = element("a", "primary-button", "Baixar imagem");
    download.href = `/api/download/${encodeURIComponent(image.id)}`;
    copy.append(tags, download);
    detail.replaceChildren(img, copy);
    const similar = document.querySelector("#similar-gallery");
    if (data.similar.length) {
      document.querySelector("#similar-section").hidden = false;
      for (const item of data.similar) similar.append(imageCard(item));
    }
  } catch {
    detail.replaceChildren(element("p", "empty-state error-message", "Imagem não encontrada."));
  }
}

addThemeHandlers();
const searchForm = document.querySelector("#search-form");
searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  setQuery({ ...currentParams(), q: document.querySelector("#search-input").value.trim().slice(0, 100), page: 1 });
});
window.addEventListener("popstate", () => renderGallery());
renderGallery();
renderPin();
