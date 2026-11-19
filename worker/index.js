const SESSION_COOKIE = "lum_admin_session";
const SESSION_SECONDS = 30 * 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const downloadBuckets = new Map();
const encoder = new TextEncoder();

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function cookieValue(request, name) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function secureCookie(value, request, maxAge = SESSION_SECONDS) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

function normalizeTag(input) {
  const name = input.replace(/#/g, "").trim().replace(/\s+/g, " ").toLowerCase().normalize("NFC");
  const slug = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return { name, slug };
}

function validImage(bytes) {
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    return { type: "image/jpeg", extension: "jpg" };
  }
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) {
    return { type: "image/png", extension: "png" };
  }
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    return { type: "image/webp", extension: "webp" };
  }
  const gif = String.fromCharCode(...bytes.slice(0, 6));
  if (bytes.length >= 6 && (gif === "GIF87a" || gif === "GIF89a")) {
    return { type: "image/gif", extension: "gif" };
  }
  return null;
}

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) return null;
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return new Uint8Array(bytes);
}

function encodeBase32(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let index = 0; index + 5 <= bits.length; index += 5) {
    output += alphabet[Number.parseInt(bits.slice(index, index + 5), 2)];
  }
  return output;
}

async function hmacKey(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET must be configured with at least 32 characters.");
  }
  return crypto.subtle.importKey("raw", encoder.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function hashIdentifier(env, value) {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(env), encoder.encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function makeSession(env, username, mfa) {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({
    sub: username,
    role: "admin",
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
    mfa,
  })));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(env), encoder.encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function getAdmin(request, env) {
  const raw = cookieValue(request, SESSION_COOKIE);
  if (!raw) return null;
  const [payload, encodedSignature, ...extra] = raw.split(".");
  if (!payload || !encodedSignature || extra.length) return null;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(env),
      base64UrlDecode(encodedSignature),
      encoder.encode(payload),
    );
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
    if (claims.role !== "admin" || !Number.isInteger(claims.exp) || claims.exp <= Date.now() / 1000) return null;
    const admin = await env.DB.prepare("SELECT username FROM admins WHERE username = ?").bind(claims.sub).first();
    if (!admin) return null;
    const totp = await env.DB.prepare("SELECT value FROM settings WHERE key = 'totp_secret'").first();
    if (totp && claims.mfa !== true) return null;
    return { username: admin.username, mfa: claims.mfa === true };
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith("SESSION_SECRET")) throw cause;
    return null;
  }
}

async function requireAdmin(request, env) {
  const admin = await getAdmin(request, env);
  return admin ? { admin } : {
    response: json({ error: "Não autorizado.", loginPath: env.ADMIN_LOGIN_PATH }, 401),
  };
}

async function audit(env, action, actor = "admin", entityId = null, userHash = null, ipHash = null) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO audit_log (id, actor, action, entity_id, user_hash, ip_hash, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(id, actor, action, entityId, userHash, ipHash, new Date().toISOString()).run();
  await env.DB.prepare(
    "DELETE FROM audit_log WHERE id IN (SELECT id FROM audit_log ORDER BY at DESC LIMIT -1 OFFSET 10000)",
  ).run();
}

async function readTagsForImages(env, images) {
  if (!images.length) return new Map();
  const placeholders = images.map(() => "?").join(",");
  const result = await env.DB.prepare(
    `SELECT it.image_id, t.id, t.name, t.slug
     FROM image_tags it JOIN gallery_tags t ON t.id = it.tag_id
     WHERE it.image_id IN (${placeholders}) ORDER BY t.name`,
  ).bind(...images.map((image) => image.id)).all();
  const byImage = new Map(images.map((image) => [image.id, []]));
  for (const row of result.results) byImage.get(row.image_id)?.push({ id: row.id, name: row.name, slug: row.slug });
  return byImage;
}

function imageDto(row, tags = []) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    external_url: row.external_url,
    width: row.width,
    height: row.height,
    created_at: row.created_at,
    updated_at: row.updated_at,
    tags,
    image_url: row.external_url ?? `/api/gallery/image/${row.id}?variant=full`,
    thumbnail_url: row.external_url ?? `/api/gallery/image/${row.id}?variant=thumbnail`,
  };
}

async function galleryList(request, env) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const tag = (url.searchParams.get("tag") ?? "").trim().slice(0, 80);
  const page = Math.max(1, Math.min(1000, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1));
  const pageSize = 30;
  const conditions = [];
  const values = [];
  if (query) {
    conditions.push("instr(lower(i.title), lower(?)) > 0");
    values.push(query);
  }
  if (tag) {
    conditions.push(`EXISTS (
      SELECT 1 FROM image_tags it JOIN gallery_tags t ON t.id = it.tag_id
      WHERE it.image_id = i.id AND t.slug = ?
    )`);
    values.push(tag);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = await env.DB.prepare(`SELECT COUNT(*) AS count FROM gallery_images i ${where}`).bind(...values).first();
  const result = await env.DB.prepare(
    `SELECT i.* FROM gallery_images i ${where}
     ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
  ).bind(...values, pageSize, (page - 1) * pageSize).all();
  const tags = await readTagsForImages(env, result.results);
  const allTags = await env.DB.prepare("SELECT id, name, slug FROM gallery_tags ORDER BY name").all();
  return json({
    images: result.results.map((image) => imageDto(image, tags.get(image.id))),
    tags: allTags.results,
    total: total.count,
    page,
    pageSize,
    totalPages: Math.ceil(total.count / pageSize),
  }, 200, { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" });
}

async function getGalleryImage(env, id) {
  if (!UUID_RE.test(id)) return null;
  return env.DB.prepare("SELECT * FROM gallery_images WHERE id = ?").bind(id).first();
}

async function galleryDetail(env, id) {
  const image = await getGalleryImage(env, id);
  if (!image) return error("Imagem não encontrada.", 404);
  const tags = await readTagsForImages(env, [image]);
  const ownTags = tags.get(id) ?? [];
  const similar = await env.DB.prepare(
    `SELECT i.*, COUNT(DISTINCT shared.tag_id) AS shared_count
     FROM gallery_images i
     JOIN image_tags shared ON shared.image_id = i.id
     WHERE i.id != ? AND shared.tag_id IN (
       SELECT tag_id FROM image_tags WHERE image_id = ?
     )
     GROUP BY i.id
     ORDER BY shared_count DESC, i.created_at DESC
     LIMIT 24`,
  ).bind(id, id).all();
  const similarTags = await readTagsForImages(env, similar.results);
  return json({
    image: imageDto(image, ownTags),
    similar: similar.results.map((item) => imageDto(item, similarTags.get(item.id))),
  }, 200, { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" });
}

async function imageResponse(request, env, id, download = false) {
  const image = await getGalleryImage(env, id);
  if (!image) return error("Imagem não encontrada.", 404);
  if (image.external_url) {
    if (download) return Response.redirect(image.external_url, 302);
    return error("Imagem externa.", 404);
  }
  const variant = download || new URL(request.url).searchParams.get("variant") !== "thumbnail" ? "full" : "thumbnail";
  const object = await env.IMAGES.get(variant === "full" ? image.full_key : image.thumbnail_key);
  if (!object) return error("Imagem não encontrada.", 404);
  const headers = new Headers({
    "Content-Type": object.httpMetadata?.contentType ?? image.content_type ?? "image/webp",
    "Cache-Control": download ? "private, no-store" : "public, max-age=3600, stale-while-revalidate=86400",
    "X-Content-Type-Options": "nosniff",
  });
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  const extension = {
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
  }[image.content_type] ?? "webp";
  if (download) headers.set("Content-Disposition", `attachment; filename="${id}.${extension}"`);
  return new Response(object.body, { headers });
}

function parseTags(raw) {
  const seen = new Set();
  return raw.split(",").map((name) => normalizeTag(name)).filter(({ name, slug }) => {
    if (!name || !slug || seen.has(slug)) return false;
    seen.add(slug);
    return true;
  }).slice(0, 20);
}

async function setImageTags(env, imageId, tags) {
  await env.DB.prepare("DELETE FROM image_tags WHERE image_id = ?").bind(imageId).run();
  for (const tag of tags) {
    const existing = await env.DB.prepare("SELECT id FROM gallery_tags WHERE slug = ?").bind(tag.slug).first();
    const tagId = existing?.id ?? crypto.randomUUID();
    if (!existing) {
      await env.DB.prepare("INSERT INTO gallery_tags (id, name, slug) VALUES (?, ?, ?)")
        .bind(tagId, tag.name, tag.slug).run();
    }
    await env.DB.prepare("INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)")
      .bind(imageId, tagId).run();
  }
}

async function adminData(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = 50;
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM gallery_images").first();
  const items = await env.DB.prepare(
    "SELECT * FROM gallery_images ORDER BY created_at DESC LIMIT ? OFFSET ?",
  ).bind(pageSize, (page - 1) * pageSize).all();
  const imageTags = await readTagsForImages(env, items.results);
  const tags = await env.DB.prepare("SELECT id, name, slug FROM gallery_tags ORDER BY name").all();
  const totp = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('totp_secret', 'totp_pending_secret')").all();
  const settings = Object.fromEntries(totp.results.map((row) => [row.key, row.value]));
  return json({
    images: items.results.map((image) => imageDto(image, imageTags.get(image.id))),
    tags: tags.results,
    total: count.count,
    page,
    pageSize,
    totalPages: Math.ceil(count.count / pageSize),
    totpEnabled: Boolean(settings.totp_secret),
    pendingTotpSecret: settings.totp_pending_secret ?? null,
  }, 200, { "Cache-Control": "private, no-store" });
}

async function rateLimitLogin(env, username, ip) {
  const now = Date.now();
  const keys = [
    await hashIdentifier(env, `user:${username}`),
    await hashIdentifier(env, `ip:${ip}`),
  ];
  for (const key of keys) {
    const attempt = await env.DB.prepare("SELECT count, window_started_at, locked_until FROM login_attempts WHERE key_hash = ?")
      .bind(key).first();
    if (attempt?.locked_until > now) return { blocked: true, minutes: Math.ceil((attempt.locked_until - now) / 60000) };
  }
  return { keys };
}

async function recordLoginFailure(env, keys, userHash, ipHash) {
  const now = Date.now();
  for (const key of keys) {
    const attempt = await env.DB.prepare("SELECT count, window_started_at FROM login_attempts WHERE key_hash = ?")
      .bind(key).first();
    const fresh = !attempt || now - attempt.window_started_at >= 15 * 60_000;
    const count = fresh ? 1 : Math.min(attempt.count + 1, 5);
    const lockedUntil = count >= 5 ? now + 15 * 60_000 : null;
    await env.DB.prepare(
      `INSERT INTO login_attempts (key_hash, count, window_started_at, locked_until)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key_hash) DO UPDATE SET count = excluded.count,
         window_started_at = excluded.window_started_at, locked_until = excluded.locked_until`,
    ).bind(key, count, fresh ? now : attempt.window_started_at, lockedUntil).run();
  }
  await audit(env, "login.failure", "anonymous", null, userHash, ipHash);
}

async function clearLoginFailures(env, keys, username, userHash, ipHash) {
  for (const key of keys) await env.DB.prepare("DELETE FROM login_attempts WHERE key_hash = ?").bind(key).run();
  await audit(env, "login.success", username, null, userHash, ipHash);
}

async function compareSecret(input, expected) {
  const [inputHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(input)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(inputHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function verifyTotp(secret, input, now = Date.now()) {
  if (!/^\d{6}$/.test(input)) return false;
  const keyBytes = decodeBase32(secret);
  if (!keyBytes?.length) return false;
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const counter = Math.floor(now / 30_000);
  for (const delta of [-1, 0, 1]) {
    const message = new Uint8Array(8);
    new DataView(message.buffer).setBigUint64(0, BigInt(counter + delta));
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
    const offset = digest[digest.length - 1] & 15;
    const binary = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16)
      | (digest[offset + 2] << 8) | digest[offset + 3];
    if (String(binary % 1_000_000).padStart(6, "0") === input) return true;
  }
  return false;
}

async function login(request, env) {
  if (!isSameOrigin(request)) return error("Requisição inválida.", 403);
  if (!env.ADMIN_PASSWORD) return error("Autenticação não configurada.", 503);
  const form = await request.formData();
  const username = String(form.get("username") ?? "").trim().toLowerCase().slice(0, 64);
  const password = String(form.get("password") ?? "").slice(0, 128);
  const code = String(form.get("totp") ?? "").trim();
  if (!username || !password) return error("Usuário ou senha inválidos.", 400);
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const userHash = await hashIdentifier(env, `user:${username}`);
  const ipHash = await hashIdentifier(env, `ip:${ip}`);
  const limit = await rateLimitLogin(env, username, ip);
  if (limit.blocked) return json({ error: "Muitas tentativas. Tente novamente mais tarde.", minutes: limit.minutes }, 429);
  const keys = limit.keys;
  const [admin, totp] = await Promise.all([
    env.DB.prepare("SELECT username FROM admins WHERE username = ?").bind(username).first(),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'totp_secret'").first(),
  ]);
  const validPassword = await compareSecret(password, env.ADMIN_PASSWORD);
  const validTotp = !totp || await verifyTotp(totp.value, code);
  if (!admin || !validPassword || !validTotp) {
    await recordLoginFailure(env, keys, userHash, ipHash);
    return error("Usuário, senha ou código inválidos.", 401);
  }
  await clearLoginFailures(env, keys, username, userHash, ipHash);
  const session = await makeSession(env, username, Boolean(totp));
  return json({ ok: true }, 200, {
    "Set-Cookie": secureCookie(session, request),
    "Cache-Control": "no-store",
  });
}

async function totpSetup(request, env, operation) {
  const auth = await requireAdmin(request, env);
  if (auth.response) return auth.response;
  if (operation === "setup") {
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    const secret = encodeBase32(bytes);
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES ('totp_pending_secret', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).bind(secret).run();
    await audit(env, "totp.setup");
    const uri = `otpauth://totp/lum-admin?secret=${secret}&issuer=lum&algorithm=SHA1&digits=6&period=30`;
    return json({ secret, uri }, 200, { "Cache-Control": "private, no-store" });
  }
  if (operation === "confirm") {
    const form = await request.formData();
    const code = String(form.get("code") ?? "").trim();
    const pending = await env.DB.prepare("SELECT value FROM settings WHERE key = 'totp_pending_secret'").first();
    if (!pending || !await verifyTotp(pending.value, code)) return error("Código TOTP inválido.", 400);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO settings (key, value) VALUES ('totp_secret', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(pending.value),
      env.DB.prepare("DELETE FROM settings WHERE key = 'totp_pending_secret'"),
    ]);
    await audit(env, "totp.enabled");
    return json({ ok: true }, 200, { "Cache-Control": "no-store" });
  }
  if (operation === "disable") {
    await env.DB.prepare("DELETE FROM settings WHERE key IN ('totp_secret', 'totp_pending_secret')").run();
    await audit(env, "totp.disabled");
    return json({ ok: true }, 200, {
      "Set-Cookie": secureCookie("", request, 0),
      "Cache-Control": "no-store",
    });
  }
  return error("Operação inválida.", 404);
}

async function adminImageCreate(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.response) return auth.response;
  const form = await request.formData();
  const file = form.get("file");
  const imageUrl = String(form.get("imageUrl") ?? "").trim();
  const titleInput = String(form.get("title") ?? "").trim().slice(0, 160);
  const descriptionInput = String(form.get("description") ?? "").trim().slice(0, 5000) || null;
  const tags = parseTags(String(form.get("tags") ?? ""));
  if ((!file || typeof file.arrayBuffer !== "function") && !imageUrl) return error("Selecione um arquivo ou URL.");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  let externalUrl = null;
  let fullKey = null;
  let thumbnailKey = null;
  let contentType = "image/webp";
  let width = Number.parseInt(String(form.get("width") ?? "1200"), 10);
  let height = Number.parseInt(String(form.get("height") ?? "900"), 10);

  if (file && typeof file.arrayBuffer === "function" && file.size > 0) {
    const maxBytes = Math.max(1, Math.min(50, Number.parseInt(env.MAX_UPLOAD_MB ?? "10", 10) || 10)) * 1024 * 1024;
    const thumbnail = form.get("thumbnail");
    if (file.size > maxBytes || (thumbnail && thumbnail.size > maxBytes)) return error("Arquivo acima do limite permitido.", 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const imageType = validImage(bytes);
    if (!imageType) return error("Tipo de imagem inválido.", 415);
    const thumbnailBytes = thumbnail && typeof thumbnail.arrayBuffer === "function"
      ? new Uint8Array(await thumbnail.arrayBuffer()) : bytes;
    if (!validImage(thumbnailBytes)) return error("Miniatura inválida.", 415);
    contentType = imageType.type;
    fullKey = `images/${id}/full.${imageType.extension}`;
    const thumbnailType = validImage(thumbnailBytes);
    thumbnailKey = `images/${id}/thumbnail.${thumbnailType.extension}`;
    width = Math.max(1, Math.min(10000, width || 1200));
    height = Math.max(1, Math.min(10000, height || 900));
    try {
      await env.IMAGES.put(fullKey, bytes, {
        httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
      });
      await env.IMAGES.put(thumbnailKey, thumbnailBytes, {
        httpMetadata: { contentType: thumbnailType.type, cacheControl: "public, max-age=31536000, immutable" },
      });
    } catch (cause) {
      await Promise.all([env.IMAGES.delete(fullKey).catch(() => undefined), env.IMAGES.delete(thumbnailKey).catch(() => undefined)]);
      throw cause;
    }
    const fallbackTitle = file.name.replace(/\.[^.]+$/, "").slice(0, 160);
    const title = titleInput || fallbackTitle || "Imagem sem título";
    await env.DB.prepare(
      `INSERT INTO gallery_images
       (id, title, description, full_key, thumbnail_key, content_type, width, height, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, title, descriptionInput, fullKey, thumbnailKey, contentType, width, height, now, now).run();
  } else {
    let parsed;
    try {
      parsed = new URL(imageUrl);
    } catch {
      return error("URL inválida.");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return error("Use apenas URLs HTTPS públicas.");
    externalUrl = parsed.href;
    const fallbackTitle = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).at(-1) ?? "Imagem")
      .replace(/\.[^.]+$/, "").slice(0, 160);
    await env.DB.prepare(
      `INSERT INTO gallery_images
       (id, title, description, external_url, content_type, width, height, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'image/webp', 1200, 900, ?, ?)`,
    ).bind(id, titleInput || fallbackTitle || "Imagem sem título", descriptionInput, externalUrl, now, now).run();
  }
  await setImageTags(env, id, tags);
  await audit(env, "image.create", auth.admin.username, id);
  return json({ ok: true, id });
}

async function adminImageUpdate(request, env, id) {
  const auth = await requireAdmin(request, env);
  if (auth.response) return auth.response;
  if (!UUID_RE.test(id)) return error("Imagem não encontrada.", 404);
  const image = await getGalleryImage(env, id);
  if (!image) return error("Imagem não encontrada.", 404);
  const form = await request.formData();
  const operation = String(form.get("operation") ?? "update");
  if (operation === "delete") {
    await env.DB.prepare("DELETE FROM gallery_images WHERE id = ?").bind(id).run();
    if (image.full_key) await env.IMAGES.delete(image.full_key);
    if (image.thumbnail_key) await env.IMAGES.delete(image.thumbnail_key);
    await audit(env, "image.delete", auth.admin.username, id);
    return json({ ok: true });
  }
  const title = String(form.get("title") ?? "").trim().slice(0, 160);
  if (!title) return error("O título é obrigatório.");
  const description = String(form.get("description") ?? "").trim().slice(0, 5000) || null;
  const tags = parseTags(String(form.get("tags") ?? ""));
  await env.DB.prepare("UPDATE gallery_images SET title = ?, description = ?, updated_at = ? WHERE id = ?")
    .bind(title, description, new Date().toISOString(), id).run();
  await setImageTags(env, id, tags);
  await audit(env, "image.update", auth.admin.username, id);
  return json({ ok: true });
}

async function adminTags(request, env) {
  const auth = await requireAdmin(request, env);
  if (auth.response) return auth.response;
  const form = await request.formData();
  const operation = String(form.get("operation") ?? "");
  const sourceId = String(form.get("sourceId") ?? "");
  const source = await env.DB.prepare("SELECT id, name, slug FROM gallery_tags WHERE id = ?").bind(sourceId).first();
  if (!source) return error("Tag não encontrada.", 404);
  if (operation === "rename") {
    const tag = normalizeTag(String(form.get("newName") ?? ""));
    if (!tag.name || !tag.slug) return error("Nome de tag inválido.");
    const duplicate = await env.DB.prepare("SELECT id FROM gallery_tags WHERE slug = ? AND id != ?").bind(tag.slug, sourceId).first();
    if (duplicate) return error("Já existe uma tag com este nome.");
    await env.DB.prepare("UPDATE gallery_tags SET name = ?, slug = ? WHERE id = ?").bind(tag.name, tag.slug, sourceId).run();
  } else if (operation === "merge") {
    const targetId = String(form.get("targetId") ?? "");
    const target = await env.DB.prepare("SELECT id FROM gallery_tags WHERE id = ?").bind(targetId).first();
    if (!target || target.id === sourceId) return error("Escolha uma tag de destino válida.");
    const images = await env.DB.prepare("SELECT image_id FROM image_tags WHERE tag_id = ?").bind(sourceId).all();
    for (const row of images.results) {
      await env.DB.prepare("INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)")
        .bind(row.image_id, targetId).run();
    }
    await env.DB.prepare("DELETE FROM image_tags WHERE tag_id = ?").bind(sourceId).run();
    await env.DB.prepare("DELETE FROM gallery_tags WHERE id = ?").bind(sourceId).run();
  } else if (operation === "delete") {
    const usage = await env.DB.prepare("SELECT COUNT(*) AS count FROM image_tags WHERE tag_id = ?").bind(sourceId).first();
    if (usage.count) return error("A tag ainda está em uso.");
    await env.DB.prepare("DELETE FROM gallery_tags WHERE id = ?").bind(sourceId).run();
  } else {
    return error("Operação inválida.");
  }
  await audit(env, `tag.${operation}`, auth.admin.username, sourceId);
  return json({ ok: true });
}

async function authorizeImport(request, env) {
  const expected = env.DATA_IMPORT_TOKEN;
  const authorization = request.headers.get("authorization") ?? "";
  if (!expected || !authorization.startsWith("Bearer ")) return false;
  return compareSecret(authorization.slice(7), expected);
}

async function importObject(request, env) {
  if (!await authorizeImport(request, env)) return error("Não autorizado.", 401);
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!/^images\/[0-9a-f-]{36}\/(?:full|thumbnail)\.webp$/i.test(key)) return error("Chave de objeto inválida.");
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 50 * 1024 * 1024) return error("Tamanho de arquivo inválido.", 413);
  const signature = validImage(new Uint8Array(bytes));
  if (!signature) return error("Tipo de imagem inválido.", 415);
  await env.IMAGES.put(key, bytes, {
    httpMetadata: { contentType: signature.type, cacheControl: "public, max-age=31536000, immutable" },
  });
  return json({ ok: true, key });
}

async function importMetadata(request, env) {
  if (!await authorizeImport(request, env)) return error("Não autorizado.", 401);
  const gallery = await request.json();
  if (gallery?.version !== 1 || !Array.isArray(gallery.images) || gallery.images.length > 20_000
      || !Array.isArray(gallery.admins) || gallery.admins.length > 20
      || !Array.isArray(gallery.tags) || gallery.tags.length > 2_000
      || !gallery.login_attempts || typeof gallery.login_attempts !== "object"
      || !Array.isArray(gallery.audit_log)) {
    return error("Formato do arquivo de galeria inválido.");
  }
  const statements = [];
  const tagsBySlug = new Map();
  for (const tag of gallery.tags) {
    if (!tag?.id || typeof tag.name !== "string") continue;
    const normalized = normalizeTag(tag.name);
    if (normalized.slug) {
      tagsBySlug.set(normalized.slug, { id: tag.id, ...normalized });
      statements.push(env.DB.prepare(
        "INSERT OR REPLACE INTO gallery_tags (id, name, slug) VALUES (?, ?, ?)",
      ).bind(tag.id, normalized.name, normalized.slug));
    }
  }
  for (const image of gallery.images) {
    for (const rawTag of Array.isArray(image.tags) ? image.tags.slice(0, 20) : []) {
      if (typeof rawTag !== "string") continue;
      const normalized = normalizeTag(rawTag);
      if (!normalized.slug || tagsBySlug.has(normalized.slug)) continue;
      const tag = { id: crypto.randomUUID(), ...normalized };
      tagsBySlug.set(tag.slug, tag);
      statements.push(env.DB.prepare(
        "INSERT OR IGNORE INTO gallery_tags (id, name, slug) VALUES (?, ?, ?)",
      ).bind(tag.id, tag.name, tag.slug));
    }
  }
  for (const username of gallery.admins) {
    if (typeof username === "string" && username.trim()) {
      statements.push(env.DB.prepare("INSERT OR REPLACE INTO admins (username) VALUES (?)").bind(username.trim().toLowerCase()));
    }
  }
  for (const image of gallery.images) {
    if (!image?.id || !UUID_RE.test(image.id) || typeof image.title !== "string") continue;
    const externalUrl = image.external_url ?? null;
    const fullKey = externalUrl ? null : `images/${image.id}/full.webp`;
    const thumbnailKey = externalUrl ? null : `images/${image.id}/thumbnail.webp`;
    statements.push(env.DB.prepare(
      `INSERT OR REPLACE INTO gallery_images
       (id, title, description, external_url, full_key, thumbnail_key, content_type, width, height, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'image/webp', ?, ?, ?, ?)`,
    ).bind(
      image.id,
      image.title.slice(0, 160),
      typeof image.description === "string" ? image.description.slice(0, 5000) : null,
      externalUrl,
      fullKey,
      thumbnailKey,
      Math.max(1, Math.min(10000, Number(image.width) || 1200)),
      Math.max(1, Math.min(10000, Number(image.height) || 900)),
      typeof image.created_at === "string" ? image.created_at : new Date().toISOString(),
      typeof image.updated_at === "string" ? image.updated_at : new Date().toISOString(),
    ));
    statements.push(env.DB.prepare("DELETE FROM image_tags WHERE image_id = ?").bind(image.id));
    for (const rawTag of Array.isArray(image.tags) ? image.tags.slice(0, 20) : []) {
      if (typeof rawTag !== "string") continue;
      const { slug } = normalizeTag(rawTag);
      if (!slug) continue;
      const tag = tagsBySlug.get(slug);
      if (tag) {
        statements.push(env.DB.prepare("INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)")
          .bind(image.id, tag.id));
      }
    }
  }
  for (const [key, value] of Object.entries(gallery.login_attempts).slice(0, 10000)) {
    if (!/^[0-9a-f]{64}$/.test(key) || !value || !Number.isInteger(value.count)) continue;
    statements.push(env.DB.prepare(
      `INSERT OR REPLACE INTO login_attempts (key_hash, count, window_started_at, locked_until)
       VALUES (?, ?, ?, ?)`,
    ).bind(key, value.count, Number(value.window_started_at) || Date.now(), Number(value.locked_until) || null));
  }
  for (const entry of gallery.audit_log.slice(-10000)) {
    if (!entry?.id || typeof entry.actor !== "string" || typeof entry.action !== "string") continue;
    statements.push(env.DB.prepare(
      `INSERT OR REPLACE INTO audit_log (id, actor, action, entity_id, user_hash, ip_hash, at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      entry.id,
      entry.actor.slice(0, 64),
      entry.action.slice(0, 40),
      entry.entity_id ?? null,
      entry.user_hash ?? null,
      entry.ip_hash ?? null,
      entry.at ?? new Date().toISOString(),
    ));
  }
  for (const [key, value] of [
    ["totp_secret", gallery.totp_secret],
    ["totp_pending_secret", gallery.totp_pending_secret],
  ]) {
    if (typeof value === "string" && /^[A-Z2-7]{16,64}$/i.test(value)) {
      statements.push(env.DB.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).bind(key, value));
    }
  }
  for (let index = 0; index < statements.length; index += 50) {
    await env.DB.batch(statements.slice(index, index + 50));
  }
  return json({ ok: true, importedRecords: gallery.images.length, statementCount: statements.length });
}

async function routeApi(request, env) {
  const { pathname } = new URL(request.url);
  if (request.method === "PUT" && pathname === "/api/migration/object") return importObject(request, env);
  if (request.method === "POST" && pathname === "/api/migration/metadata") return importMetadata(request, env);
  if (request.method === "GET" && pathname === "/api/gallery") return galleryList(request, env);
  if (request.method === "GET" && pathname === "/api/auth/session") {
    const [admin, totp] = await Promise.all([
      getAdmin(request, env),
      env.DB.prepare("SELECT value FROM settings WHERE key = 'totp_secret'").first(),
    ]);
    return json({
      authenticated: Boolean(admin),
      totpRequired: Boolean(totp),
      loginPath: env.ADMIN_LOGIN_PATH,
    }, 200, { "Cache-Control": "no-store" });
  }
  if (request.method === "POST" && pathname === "/api/auth/login") return login(request, env);
  if (request.method === "POST" && pathname === "/api/auth/logout") {
    if (!isSameOrigin(request)) return error("Requisição inválida.", 403);
    const auth = await requireAdmin(request, env);
    if (auth.response) return auth.response;
    return json({ ok: true }, 200, { "Set-Cookie": secureCookie("", request, 0), "Cache-Control": "no-store" });
  }
  if (request.method === "POST" && pathname.startsWith("/api/auth/totp/")) {
    if (!isSameOrigin(request)) return error("Requisição inválida.", 403);
    const operation = pathname.slice("/api/auth/totp/".length);
    return totpSetup(request, env, operation);
  }
  if (request.method === "GET" && pathname === "/api/admin/data") return adminData(request, env);
  if (request.method === "POST" && pathname === "/api/admin/images") {
    if (!isSameOrigin(request)) return error("Requisição inválida.", 403);
    return adminImageCreate(request, env);
  }
  if (request.method === "POST" && pathname === "/api/admin/tags") {
    if (!isSameOrigin(request)) return error("Requisição inválida.", 403);
    return adminTags(request, env);
  }
  const imageMatch = pathname.match(/^\/api\/admin\/images\/([^/]+)$/);
  if (imageMatch && request.method === "POST") {
    if (!isSameOrigin(request)) return error("Requisição inválida.", 403);
    return adminImageUpdate(request, env, imageMatch[1]);
  }
  const imageMatchPublic = pathname.match(/^\/api\/gallery\/image\/([^/]+)$/);
  if (imageMatchPublic && request.method === "GET") return imageResponse(request, env, imageMatchPublic[1]);
  const downloadMatch = pathname.match(/^\/api\/download\/([^/]+)$/);
  if (downloadMatch && request.method === "GET") {
    const now = Date.now();
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const bucket = downloadBuckets.get(ip);
    if (bucket && now - bucket.startedAt < 60_000 && bucket.count >= 30) return error("Muitos downloads. Tente novamente em breve.", 429);
    if (!bucket || now - bucket.startedAt >= 60_000) downloadBuckets.set(ip, { startedAt: now, count: 1 });
    else bucket.count++;
    return imageResponse(request, env, downloadMatch[1], true);
  }
  const detailMatch = pathname.match(/^\/api\/gallery\/([^/]+)$/);
  if (detailMatch && request.method === "GET") return galleryDetail(env, detailMatch[1]);
  return error("Não encontrado.", 404);
}

async function asset(request, env, path, headers) {
  const url = new URL(request.url);
  url.pathname = path;
  const response = await env.ASSETS.fetch(new Request(url, request));
  const resultHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers ?? {})) resultHeaders.set(key, value);
  resultHeaders.set("X-Content-Type-Options", "nosniff");
  resultHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");
  resultHeaders.set("X-Frame-Options", "DENY");
  resultHeaders.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  resultHeaders.set("Content-Security-Policy", "default-src 'self'; img-src 'self' https: data:; connect-src 'self'; font-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: resultHeaders });
}

async function pinPage(request, env, id) {
  const image = await getGalleryImage(env, id);
  if (!image) return new Response(null, { status: 404 });
  const response = await asset(request, env, "/pin.html");
  if (!response.ok) return response;
  const html = await response.text();
  const title = escapeHtml(image.title);
  const description = escapeHtml(image.description ?? `Veja ${image.title} na galeria lum.`);
  const imageUrl = escapeHtml(new URL(image.external_url ?? `/api/gallery/image/${image.id}?variant=full`, request.url).href);
  const rendered = html
    .replace("<title>Imagem — lum.</title>", `<title>${title} — lum.</title>`)
    .replace('content="Veja esta imagem na galeria lum."', `content="${description}"`)
    .replace('content="Imagem — lum."', `content="${title}"`)
    .replace('property="og:image" content=""', `property="og:image" content="${imageUrl}"`);
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(rendered, { status: response.status, headers });
}

async function adminPage(request, env) {
  try {
    const admin = await getAdmin(request, env);
    if (!admin) return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    const response = await asset(request, env, "/admin.html", {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    });
    const html = await response.text();
    const loginPath = escapeHtml(env.ADMIN_LOGIN_PATH);
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    headers.delete("Content-Encoding");
    headers.set("Content-Type", "text/html; charset=utf-8");
    return new Response(html.replaceAll("/entrar-8f3k2x", loginPath), { status: response.status, headers });
  } catch {
    return error("Serviço temporariamente indisponível.", 503);
  }
}

async function sitemap(request, env) {
  const origin = new URL(request.url).origin;
  const images = await env.DB.prepare("SELECT id, updated_at FROM gallery_images ORDER BY updated_at DESC").all();
  const urls = [
    `<url><loc>${origin}/</loc></url>`,
    ...images.results.map((image) =>
      `<url><loc>${origin}/pin/${encodeURIComponent(image.id)}</loc><lastmod>${escapeHtml(image.updated_at)}</lastmod></url>`),
  ];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}

async function handle(request, env) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    try {
      return await routeApi(request, env);
    } catch (cause) {
      console.error("Worker request failed", cause instanceof Error ? cause.message : "unknown error");
      return error("Serviço temporariamente indisponível.", 500);
    }
  }
  const isAdminPage = url.pathname === "/admin" || url.pathname === "/admin/" || url.pathname === "/admin.html";
  if (isAdminPage) return adminPage(request, env);
  if (url.pathname === "/admin.js") {
    const auth = await getAdmin(request, env).catch(() => null);
    if (!auth) return new Response(null, { status: 404 });
    return asset(request, env, "/admin.js", {
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    });
  }
  if (url.pathname === "/robots.txt") {
    return new Response(
      `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: ${env.ADMIN_LOGIN_PATH}\nSitemap: ${url.origin}/sitemap.xml\n`,
      { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } },
    );
  }
  if (url.pathname === "/sitemap.xml") return sitemap(request, env);
  if (url.pathname === "/pin" || url.pathname.startsWith("/pin/")) {
    const id = url.pathname.split("/")[2] ?? "";
    if (!UUID_RE.test(id)) return new Response(null, { status: 404 });
    try {
      return await pinPage(request, env, id);
    } catch (cause) {
      console.error("Pin page failed", cause instanceof Error ? cause.message : "unknown error");
      return new Response(null, { status: 503 });
    }
  }
  if (url.pathname === env.ADMIN_LOGIN_PATH || url.pathname === `${env.ADMIN_LOGIN_PATH}/`) {
    return asset(request, env, "/login.html", {
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    });
  }
  if (url.pathname === "/admin.html") {
    return new Response(null, { status: 404 });
  }
  return asset(request, env, url.pathname);
}

export default {
  async fetch(request, env) {
    return handle(request, env);
  },
};

export { escapeHtml, normalizeTag, validImage, verifyTotp };
