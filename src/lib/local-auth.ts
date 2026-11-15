import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getLocalAdminCredentials, getAdminLoginPath, runtimeConfig } from "@/lib/runtime-config";
import { ensureGalleryStorage, readGallery } from "@/lib/local-gallery";
import { sameOriginHeaders } from "@/lib/security";

const COOKIE_NAME = "lum_admin_session";
const SESSION_SECONDS = 30 * 60;
const secretPath = path.join(process.cwd(), "data", ".session-key");
const memoryBuckets = new Map<string, { startedAt: number; count: number }>();

type SessionClaims = { sub: string; role: "admin"; exp: number; mfa: boolean };

async function sessionSecret() {
  await ensureGalleryStorage();
  try {
    return await readFile(secretPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const secret = randomBytes(48);
    await writeFile(secretPath, secret, { flag: "wx", mode: 0o600 }).catch(async (writeError) => {
      if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
    });
    return readFile(secretPath);
  }
}

function hmac(secret: Buffer, value: string) {
  return createHmac("sha256", secret).update(value).digest();
}

function encode(value: string) {
  return Buffer.from(value).toString("base64url");
}

export async function createLocalSession(username: string, mfa: boolean) {
  const secret = await sessionSecret();
  const claims: SessionClaims = {
    sub: username,
    role: "admin",
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
    mfa,
  };
  const payload = encode(JSON.stringify(claims));
  const signature = hmac(secret, payload).toString("base64url");
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, `${payload}.${signature}`, {
    httpOnly: true,
    secure: runtimeConfig.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function verifyLocalSessionToken(raw: string | undefined) {
  if (runtimeConfig.NODE_ENV === "production") return null;
  if (!raw) return null;
  try {
    const [payload, signature] = raw.split(".");
    if (!payload || !signature) return null;
    const secret = await sessionSecret();
    const received = Buffer.from(signature, "base64url");
    const expected = hmac(secret, payload);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionClaims;
    if (claims.exp <= Math.floor(Date.now() / 1000) || claims.role !== "admin") return null;
    const credentials = getLocalAdminCredentials();
    if (!credentials || claims.sub !== credentials.username) return null;
    const gallery = await readGallery();
    if (!gallery.admins.includes(claims.sub)) return null;
    if (gallery.totp_secret && !claims.mfa) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function readLocalSession() {
  return verifyLocalSessionToken((await cookies()).get(COOKIE_NAME)?.value);
}

export async function requireLocalAdminPage() {
  if (!await isLocalHostRequest()) notFound();
  if (!await readLocalSession()) notFound();
}

export async function requireLocalAdminAction() {
  const requestHeaders = await headers();
  if (!await isLocalHostRequest() || !sameOriginHeaders(requestHeaders)) notFound();
  if (!await readLocalSession()) redirect(getAdminLoginPath());
}

export async function authorizeLocalAdminApi() {
  return await isLocalHostRequest() && (await readLocalSession()) !== null;
}

export async function destroyLocalSession() {
  (await cookies()).delete(COOKIE_NAME);
}

export async function checkMemoryLoginLimit(key: string) {
  const now = Date.now();
  if (memoryBuckets.size > 10_000) {
    for (const [bucketKey, value] of memoryBuckets) {
      if (now - value.startedAt >= 15 * 60_000) memoryBuckets.delete(bucketKey);
    }
  }
  const bucket = memoryBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= 15 * 60_000) {
    memoryBuckets.set(key, { startedAt: now, count: 1 });
    return { allowed: true, remainingMs: 0 };
  }
  if (bucket.count >= 20) return { allowed: false, remainingMs: 15 * 60_000 - (now - bucket.startedAt) };
  bucket.count += 1;
  return { allowed: true, remainingMs: 0 };
}

export async function hashLoginIdentifier(value: string) {
  return hmac(await sessionSecret(), value).toString("hex");
}

export async function loginIdentityHash(username: string) {
  return hashLoginIdentifier(`user:${username.toLowerCase()}`);
}

export async function loginIpHash() {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? requestHeaders.get("x-real-ip")
    ?? "unknown";
  return hashLoginIdentifier(`ip:${forwarded}`);
}

export async function isLocalHostRequest() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "";
  const hostname = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export async function isAuthorizedLocalUser(username: string, password: string) {
  const credentials = getLocalAdminCredentials();
  if (!credentials || username.trim().toLowerCase() !== credentials.username) return false;
  const provided = hmac(Buffer.from("lum-credential-check"), password);
  const expected = hmac(Buffer.from("lum-credential-check"), credentials.password);
  return timingSafeEqual(provided, expected);
}

export async function accountLockStatus(userHash: string) {
  const gallery = await readGallery();
  const entry = gallery.login_attempts[userHash];
  if (entry?.locked_until && entry.locked_until > Date.now()) {
    return Math.ceil((entry.locked_until - Date.now()) / 60_000);
  }
  return 0;
}

export async function verifyTotp(secret: string, input: string, now = Date.now()) {
  const normalized = secret.replace(/\s+/g, "").toUpperCase();
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of normalized.replace(/=+$/, "")) {
    const index = alphabet.indexOf(char);
    if (index < 0) return false;
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.from(bits.match(/.{8}/g)?.map((byte) => Number.parseInt(byte, 2)) ?? []);
  const counter = Math.floor(now / 30_000);
  for (const delta of [-1, 0, 1]) {
    const moving = Buffer.alloc(8);
    moving.writeBigUInt64BE(BigInt(counter + delta));
    const digest = createHmac("sha1", bytes).update(moving).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
    if (value.toString().padStart(6, "0") === input) return true;
  }
  return false;
}

export function getLoginPath() {
  return getAdminLoginPath();
}
