import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

const localRateBuckets = new Map<string, { startedAt: number; hits: number }>();

export async function enforceRateLimit(
  headers: Headers,
  scope: "login" | "search" | "download",
  limit: number,
  windowSeconds: number,
) {
  const forwarded = headers.get("x-vercel-forwarded-for") ?? headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
  const digest = hashIdentifier(ip);
  const key = `${scope}:${digest}`;
  const now = Date.now();
  if (localRateBuckets.size > 10_000) {
    for (const [bucketKey, bucket] of localRateBuckets) {
      if (now - bucket.startedAt >= windowSeconds * 1000) localRateBuckets.delete(bucketKey);
    }
  }
  const bucket = localRateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= windowSeconds * 1000) {
    localRateBuckets.set(key, { startedAt: now, hits: 1 });
    return true;
  }
  bucket.hits += 1;
  return bucket.hits <= limit;
}

export function hashIdentifier(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function requestIpHash(headers: Headers) {
  const forwarded = headers.get("x-vercel-forwarded-for") ?? headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
  return hashIdentifier(ip);
}

export function sameOriginRequest(request: Request) {
  return sameOriginHeaders(request.headers);
}

export function sameOriginHeaders(headers: Headers) {
  const origin = headers.get("origin");
  const host = headers.get("host");
  if (!origin || !host) return false;
  try {
    const originUrl = new URL(origin);
    const protocol = headers.get("x-forwarded-proto")?.split(",")[0] ?? "http";
    const requestOrigin = `${protocol}://${host}`;
    if (process.env.NODE_ENV === "development") return originUrl.origin === requestOrigin;
    const configured = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? requestOrigin).origin;
    return originUrl.origin === configured && originUrl.origin === requestOrigin;
  } catch {
    return false;
  }
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}
