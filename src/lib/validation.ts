import { z } from "zod";

export const imageFieldsSchema = z.object({
  title: z.string().trim().max(160).default(""),
  description: z.string().trim().max(5000).optional().default(""),
  tags: z.array(z.string().trim().min(1).max(50)).max(20),
});

export function normalizeTag(name: string) {
  const displayName = name.replace(/#/g, "").trim().replace(/\s+/g, " ").toLowerCase().normalize("NFC");
  const slugSource = displayName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return {
    name: displayName,
    slug: slugSource.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  };
}

export function hasImageSignature(bytes: Buffer) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) return "gif";
  return null;
}
