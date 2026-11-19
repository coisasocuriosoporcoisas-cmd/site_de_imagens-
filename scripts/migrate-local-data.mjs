import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const galleryPath = path.join(root, "data", "gallery.json");
const imageDirectory = path.join(root, "data", "images");
const dryRun = process.argv.includes("--dry-run");
const args = process.argv.slice(2);
const urlIndex = args.indexOf("--url");
const baseUrl = urlIndex >= 0 ? args[urlIndex + 1] : process.env.MIGRATION_URL;
const devVars = await readFile(path.join(root, ".dev.vars"), "utf8").catch(() => "");
const token = process.env.DATA_IMPORT_TOKEN
  ?? devVars.split(/\r?\n/).find((line) => line.startsWith("DATA_IMPORT_TOKEN="))?.slice("DATA_IMPORT_TOKEN=".length);

async function uploadImage(image, variant, key, endpoint) {
  const suffix = variant === "full" ? "full" : "thumbnail";
  const localFile = path.resolve(imageDirectory, `${image.id}-${suffix}.webp`);
  if (!localFile.startsWith(`${path.resolve(imageDirectory)}${path.sep}`)) {
    throw new Error("Unsafe image file path in gallery data.");
  }
  await stat(localFile);
  if (dryRun) return;
  const bytes = await readFile(localFile);
  const response = await fetch(`${endpoint}/api/migration/object?key=${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "image/webp",
    },
    body: bytes,
  });
  if (!response.ok) throw new Error(`Image upload failed (${response.status}): ${await response.text()}`);
}

async function main() {
  const gallery = JSON.parse(await readFile(galleryPath, "utf8"));
  if (gallery.version !== 1 || !Array.isArray(gallery.images) || !Array.isArray(gallery.admins)) {
    throw new Error("data/gallery.json has an unsupported structure.");
  }
  const localImages = gallery.images.filter((image) => !image.external_url);
  console.log(`Found ${gallery.images.length} gallery records and ${localImages.length * 2} local image files.`);
  console.log(`Found ${gallery.tags?.length ?? 0} tags, ${gallery.admins.length} admin(s), and ${gallery.audit_log?.length ?? 0} audit entries.`);
  if (dryRun) {
    for (const image of localImages) {
      await uploadImage(image, "full", `images/${image.id}/full.webp`);
    }
    console.log("Dry run complete. No Cloudflare resources were changed.");
    return;
  }
  if (!baseUrl || !token) {
    throw new Error("Set MIGRATION_URL (or pass --url) and DATA_IMPORT_TOKEN before importing.");
  }
  const parsedUrl = new URL(baseUrl);
  if (parsedUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsedUrl.hostname)) {
    throw new Error("MIGRATION_URL must use HTTPS, except for localhost development.");
  }
  const endpoint = parsedUrl.origin;
  const uploads = localImages.flatMap((image) => [
    () => uploadImage(image, "full", `images/${image.id}/full.webp`, endpoint),
    () => uploadImage(image, "thumbnail", `images/${image.id}/thumbnail.webp`, endpoint),
  ]);
  const concurrency = 6;
  for (let offset = 0; offset < uploads.length; offset += concurrency) {
    const batch = uploads.slice(offset, offset + concurrency);
    const results = await Promise.allSettled(batch.map((upload) => upload()));
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    const done = Math.min(offset + batch.length, uploads.length);
    if (done % 40 === 0 || done === uploads.length) console.log(`Uploaded ${done} of ${uploads.length} image files…`);
  }
  const response = await fetch(`${endpoint}/api/migration/metadata`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(gallery),
  });
  if (!response.ok) throw new Error(`Metadata import failed (${response.status}): ${await response.text()}`);
  const result = await response.json();
  console.log("Gallery data and image objects imported successfully.");
  console.log(`Imported ${result.importedRecords} records with ${result.statementCount} database operations.`);
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : "Migration failed.");
  process.exitCode = 1;
});
