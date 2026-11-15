import { isIP } from "node:net";

export function isPublicHttpsImageUrl(input: string) {
  if (input.length > 2048) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
    if (isIP(host.replace(/^\[|\]$/g, "")) !== 0) return null;
    return url.toString();
  } catch {
    return null;
  }
}
