function node(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function field(labelText, name, value, maxLength, multiline = false) {
  const label = node("label", "", labelText);
  const control = document.createElement(multiline ? "textarea" : "input");
  control.name = name;
  control.value = value ?? "";
  if (maxLength) control.maxLength = maxLength;
  label.append(control);
  return label;
}

async function request(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    location.assign(data.loginPath ?? "/entrar-8f3k2x");
    throw new Error("Sessão encerrada.");
  }
  if (!response.ok) throw new Error(data.error ?? "Não foi possível concluir a operação.");
  return data;
}

function statusMessage(message, isError = false) {
  const status = document.querySelector("#admin-status");
  status.textContent = message;
  status.classList.toggle("error-message", isError);
}

async function prepareImage(file) {
  const bitmap = await createImageBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;
  if (width * height > 40_000_000) {
    bitmap.close();
    throw new Error("Imagem acima do limite de 40 megapixels.");
  }
  if (file.type === "image/gif") {
    bitmap.close();
    return { full: file, thumbnail: file, width, height };
  }
  const scale = Math.min(1, 4096 / width, 4096 / height);
  const fullCanvas = document.createElement("canvas");
  fullCanvas.width = Math.max(1, Math.round(width * scale));
  fullCanvas.height = Math.max(1, Math.round(height * scale));
  fullCanvas.getContext("2d").drawImage(bitmap, 0, 0, fullCanvas.width, fullCanvas.height);
  const fullBlob = await new Promise((resolve, reject) => {
    fullCanvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Falha ao processar imagem.")), "image/webp", 0.84);
  });
  const thumbScale = Math.min(1, 720 / fullCanvas.width, 720 / fullCanvas.height);
  const thumbnailCanvas = document.createElement("canvas");
  thumbnailCanvas.width = Math.max(1, Math.round(fullCanvas.width * thumbScale));
  thumbnailCanvas.height = Math.max(1, Math.round(fullCanvas.height * thumbScale));
  thumbnailCanvas.getContext("2d").drawImage(fullCanvas, 0, 0, thumbnailCanvas.width, thumbnailCanvas.height);
  const thumbnail = await new Promise((resolve, reject) => {
    thumbnailCanvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Falha ao criar miniatura.")), "image/webp", 0.78);
  });
  bitmap.close();
  const baseName = file.name.replace(/\.[^.]+$/, "") || "imagem";
  return {
    full: new File([fullBlob], `${baseName}.webp`, { type: "image/webp" }),
    thumbnail: new File([thumbnail], `${baseName}-thumbnail.webp`, { type: "image/webp" }),
    width: fullCanvas.width,
    height: fullCanvas.height,
  };
}

function fillTagSelect(select, tags, includeEmpty = false) {
  select.replaceChildren();
  if (includeEmpty) select.append(new Option("Não aplicável", ""));
  for (const tag of tags) select.append(new Option(tag.name, tag.id));
}

function renderImageRow(image) {
  const row = node("article", "management-row");
  const thumbnail = document.createElement("img");
  thumbnail.src = image.thumbnail_url;
  thumbnail.alt = "";
  thumbnail.width = 66;
  thumbnail.height = 66;
  thumbnail.loading = "lazy";
  const form = document.createElement("form");
  form.className = "form-grid";
  form.append(
    field("Título", "title", image.title, 160),
    field("Descrição", "description", image.description, 5000),
    field("Tags separadas por vírgula", "tags", image.tags.map((tag) => tag.name).join(", "), 1000),
  );
  const actions = node("div", "row-actions");
  const save = node("button", "quiet-button", "Salvar");
  save.type = "submit";
  save.name = "operation";
  save.value = "update";
  const remove = node("button", "quiet-button danger-button", "Excluir");
  remove.type = "submit";
  remove.name = "operation";
  remove.value = "delete";
  actions.append(save, remove);
  form.append(actions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const operation = event.submitter?.value ?? "update";
    if (operation === "delete" && !confirm(`Excluir “${image.title}”?`)) return;
    const body = new FormData(form);
    body.set("operation", operation);
    try {
      await request(`/api/admin/images/${encodeURIComponent(image.id)}`, { method: "POST", body });
      statusMessage(operation === "delete" ? "Imagem excluída." : "Imagem atualizada.");
      await loadAdmin();
    } catch (cause) {
      statusMessage(cause.message, true);
    }
  });
  row.append(thumbnail, form);
  return row;
}

let page = Math.max(1, Number.parseInt(new URLSearchParams(location.search).get("page") ?? "1", 10) || 1);
let currentTags = [];

async function loadAdmin() {
  const list = document.querySelector("#management-list");
  list.replaceChildren(node("p", "loading", "Carregando…"));
  try {
    const data = await request(`/api/admin/data?page=${page}`, { cache: "no-store" });
    currentTags = data.tags;
    document.querySelector("#image-count").textContent = `Imagens cadastradas (${data.total})`;
    list.replaceChildren();
    if (!data.images.length) list.append(node("p", "status-message", "Nenhuma imagem cadastrada ainda."));
    else for (const image of data.images) list.append(renderImageRow(image));
    const pagination = document.querySelector("#admin-pagination");
    pagination.replaceChildren();
    if (data.page > 1) {
      const previous = node("button", "quiet-button", "Anterior");
      previous.type = "button";
      previous.addEventListener("click", () => { page--; loadAdmin(); });
      pagination.append(previous);
    }
    if (data.totalPages > 1) pagination.append(node("span", "", `Página ${data.page} de ${data.totalPages}`));
    if (data.page < data.totalPages) {
      const next = node("button", "quiet-button", "Próxima");
      next.type = "button";
      next.addEventListener("click", () => { page++; loadAdmin(); });
      pagination.append(next);
    }
    const datalist = document.querySelector("#existing-tags");
    datalist.replaceChildren(...data.tags.map((tag) => {
      const option = document.createElement("option");
      option.value = tag.name;
      return option;
    }));
    fillTagSelect(document.querySelector("#tag-form [name=sourceId]"), data.tags);
    fillTagSelect(document.querySelector("#tag-form [name=targetId]"), data.tags, true);
    renderTotp(data);
  } catch (cause) {
    list.replaceChildren(node("p", "empty-state error-message", cause.message));
  }
}

function renderTotp(data) {
  const root = document.querySelector("#totp-management");
  root.replaceChildren();
  if (data.totpEnabled) {
    root.append(node("p", "status-message", "Autenticador TOTP ativo."));
    const disable = node("button", "quiet-button", "Desativar e encerrar sessão");
    disable.type = "button";
    disable.addEventListener("click", async () => {
      if (!confirm("Desativar autenticação em duas etapas?")) return;
      try {
        await request("/api/auth/totp/disable", { method: "POST" });
        location.reload();
      } catch (cause) {
        statusMessage(cause.message, true);
      }
    });
    root.append(disable);
    return;
  }
  if (data.pendingTotpSecret) {
    root.append(node("p", "", "Adicione esta chave ao aplicativo autenticador e confirme um código de seis dígitos."));
    const secret = node("code", "totp-code", data.pendingTotpSecret);
    const uri = node("p", "status-message", `otpauth://totp/lum-admin?secret=${data.pendingTotpSecret}&issuer=lum&algorithm=SHA1&digits=6&period=30`);
    const form = document.createElement("form");
    form.className = "form-grid";
    const label = node("label", "", "Código TOTP");
    const code = document.createElement("input");
    code.name = "code";
    code.inputMode = "numeric";
    code.pattern = "[0-9]{6}";
    code.required = true;
    code.maxLength = 6;
    label.append(code);
    const confirmButton = node("button", "primary-button", "Ativar TOTP");
    confirmButton.type = "submit";
    form.append(label, confirmButton);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await request("/api/auth/totp/confirm", { method: "POST", body: new FormData(form) });
        statusMessage("Autenticação em duas etapas ativada.");
        await loadAdmin();
      } catch (cause) {
        statusMessage(cause.message, true);
      }
    });
    root.append(secret, uri, form);
    return;
  }
  const setup = node("button", "quiet-button", "Configurar autenticador TOTP");
  setup.type = "button";
  setup.addEventListener("click", async () => {
    try {
      await request("/api/auth/totp/setup", { method: "POST" });
      await loadAdmin();
    } catch (cause) {
      statusMessage(cause.message, true);
    }
  });
  root.append(setup);
}

document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme !== "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  localStorage.setItem("gallery-theme", dark ? "dark" : "light");
});
const savedTheme = localStorage.getItem("gallery-theme");
document.documentElement.dataset.theme = savedTheme === "dark" || (!savedTheme && matchMedia("(prefers-color-scheme: dark)").matches)
  ? "dark"
  : "light";

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await request("/api/auth/logout", { method: "POST" });
    location.assign("/");
  } catch (cause) {
    statusMessage(cause.message, true);
  }
});

document.querySelector("#upload-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const files = [...form.elements.files.files];
  const urls = form.elements.imageUrls.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (files.length + urls.length < 1) return statusMessage("Selecione ao menos um arquivo ou link.", true);
  if (files.length + urls.length > 50) return statusMessage("Importe até 50 itens por vez.", true);
  const title = form.elements.title.value.trim();
  const description = form.elements.description.value.trim();
  const tags = form.elements.tags.value;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  let completed = 0;
  try {
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name}: arquivo acima de 10 MB.`);
      const prepared = await prepareImage(file);
      const body = new FormData();
      body.set("file", prepared.full);
      body.set("thumbnail", prepared.thumbnail);
      body.set("width", String(prepared.width));
      body.set("height", String(prepared.height));
      body.set("title", title);
      body.set("description", description);
      body.set("tags", tags);
      await request("/api/admin/images", { method: "POST", body });
      completed++;
      statusMessage(`Importando… ${completed} de ${files.length + urls.length}`);
    }
    for (const imageUrl of urls) {
      const body = new FormData();
      body.set("imageUrl", imageUrl);
      body.set("title", title);
      body.set("description", description);
      body.set("tags", tags);
      await request("/api/admin/images", { method: "POST", body });
      completed++;
      statusMessage(`Importando… ${completed} de ${files.length + urls.length}`);
    }
    form.reset();
    statusMessage(`Importação concluída. ${completed} imagens adicionadas.`);
    await loadAdmin();
  } catch (cause) {
    statusMessage(`${cause.message} ${completed} itens já foram importados.`, true);
    await loadAdmin();
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#tag-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await request("/api/admin/tags", { method: "POST", body: new FormData(event.currentTarget) });
    statusMessage("Tags atualizadas.");
    await loadAdmin();
  } catch (cause) {
    statusMessage(cause.message, true);
  }
});

loadAdmin();
