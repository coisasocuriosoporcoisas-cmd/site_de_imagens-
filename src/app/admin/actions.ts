"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  accountLockStatus,
  checkMemoryLoginLimit,
  createLocalSession,
  destroyLocalSession,
  getLoginPath,
  isAuthorizedLocalUser,
  isLocalHostRequest,
  loginIdentityHash,
  loginIpHash,
  requireLocalAdminAction,
  verifyTotp,
} from "@/lib/local-auth";
import { clearLoginFailures, mutateGallery, readGallery, saveFailedLogin } from "@/lib/local-gallery";
import { logServerError } from "@/lib/server-logging";
import { sameOriginHeaders } from "@/lib/security";
import { getLocalAdminCredentials } from "@/lib/runtime-config";

const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
  totp: z.string().trim().regex(/^\d{6}$/).optional().or(z.literal("")),
});

function loginRedirect(status: "invalid" | "blocked" | "unavailable", minutes?: number): never {
  const url = new URL(getLoginPath(), "http://localhost");
  url.searchParams.set("status", status);
  if (minutes) url.searchParams.set("minutes", String(minutes));
  redirect(`${url.pathname}${url.search}`);
}

function base32(bytes: Buffer) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let index = 0; index + 5 <= bits.length; index += 5) {
    output += alphabet[Number.parseInt(bits.slice(index, index + 5), 2)];
  }
  return output;
}

export async function login(formData: FormData) {
  const startedAt = Date.now();
  const parsed = credentialsSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
    totp: formData.get("totp") ?? "",
  });
  let destination: { status: "invalid" | "blocked" | "unavailable"; minutes?: number } = { status: "invalid" };
  let success = false;

  try {
    const requestHeaders = await headers();
    if (!sameOriginHeaders(requestHeaders)) {
      destination = { status: "unavailable" };
    } else if (!await isLocalHostRequest()) {
      destination = { status: "unavailable" };
    } else if (!getLocalAdminCredentials()) {
      logServerError("Local admin login unavailable", new Error("Local credentials are not configured or local login is disabled."));
      destination = { status: "unavailable" };
    } else {
      const username = parsed.success ? parsed.data.username.toLowerCase() : String(formData.get("username") ?? "").trim().toLowerCase().slice(0, 64);
      const identity = await loginIdentityHash(username || "missing-user");
      const ipHash = await loginIpHash();
      const ipLimit = await checkMemoryLoginLimit(`ip:${ipHash}`);
      const userLimit = await checkMemoryLoginLimit(`user:${identity}`);
      const persistentLock = await accountLockStatus(identity);
      const blockedFor = Math.max(
        persistentLock,
        ipLimit.allowed ? 0 : Math.ceil(ipLimit.remainingMs / 60_000),
        userLimit.allowed ? 0 : Math.ceil(userLimit.remainingMs / 60_000),
      );
      if (blockedFor > 0) {
        destination = { status: "blocked", minutes: blockedFor };
      } else if (parsed.success) {
        const gallery = await readGallery();
        const correctPassword = await isAuthorizedLocalUser(username, parsed.data.password);
        const correctTotp = !gallery.totp_secret || (parsed.data.totp && await verifyTotp(gallery.totp_secret, parsed.data.totp));
        const isAdmin = gallery.admins.includes(username);
        if (correctPassword && correctTotp && isAdmin) {
          await clearLoginFailures(identity, ipHash, username);
          await createLocalSession(username, Boolean(gallery.totp_secret));
          success = true;
        } else {
          const lockedUntil = await saveFailedLogin(identity, ipHash);
          destination = lockedUntil
            ? { status: "blocked", minutes: Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60_000)) }
            : { status: "invalid" };
        }
      } else {
        const lockedUntil = await saveFailedLogin(identity, ipHash);
        destination = lockedUntil
          ? { status: "blocked", minutes: Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60_000)) }
          : { status: "invalid" };
      }
    }
  } catch (error) {
    logServerError("Local admin login failed", error);
    destination = { status: "unavailable" };
  }

  const delay = 700 - (Date.now() - startedAt);
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  if (success) redirect("/admin");
  loginRedirect(destination.status, destination.minutes);
}

export async function logout() {
  await requireLocalAdminAction();
  await destroyLocalSession();
  redirect("/");
}

export async function beginTotpSetup() {
  await requireLocalAdminAction();
  const secret = base32(randomBytes(20));
  await mutateGallery((gallery) => {
    gallery.totp_pending_secret = secret;
  });
  redirect("/admin?mfa=setup");
}

export async function confirmTotpSetup(formData: FormData) {
  await requireLocalAdminAction();
  const code = z.string().trim().regex(/^\d{6}$/).safeParse(formData.get("code"));
  if (!code.success) redirect("/admin?mfa=error");
  const gallery = await readGallery();
  if (!gallery.totp_pending_secret || !await verifyTotp(gallery.totp_pending_secret, code.data)) {
    redirect("/admin?mfa=error");
  }
  await mutateGallery((data) => {
    data.totp_secret = data.totp_pending_secret;
    delete data.totp_pending_secret;
  });
  redirect("/admin?mfa=enabled");
}

export async function disableTotp() {
  await requireLocalAdminAction();
  await mutateGallery((gallery) => {
    delete gallery.totp_secret;
    delete gallery.totp_pending_secret;
  });
  await destroyLocalSession();
  redirect(getLoginPath());
}

