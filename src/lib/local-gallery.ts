import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { runtimeConfig } from "@/lib/runtime-config";

const tagSchema = z.object({ id: z.string().min(1), name: z.string().min(1), slug: z.string().min(1) });
const imageSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(160),
  description: z.string().max(5000).nullable(),
  storage_path: z.string().optional(),
  thumbnail_path: z.string().optional(),
  external_url: z.string().url().optional(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
  tags: z.array(z.string()).max(20).default([]),
});
const auditSchema = z.object({
  id: z.string().uuid(),
  actor: z.string().max(64),
  action: z.string().max(40),
  entity_id: z.string().uuid().optional(),
  user_hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  ip_hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  at: z.string(),
});
const attemptsSchema = z.record(z.string().regex(/^[0-9a-f]{64}$/), z.object({
  count: z.number().int().min(0).max(5),
  window_started_at: z.number(),
  locked_until: z.number().optional(),
}));
const gallerySchema = z.object({
  version: z.literal(1),
  admins: z.array(z.string().min(1).max(64)).min(1).max(20),
  images: z.array(imageSchema).max(20_000),
  tags: z.array(tagSchema).max(2_000),
  login_attempts: attemptsSchema,
  audit_log: z.array(auditSchema).max(10_000),
  totp_secret: z.string().regex(/^[A-Z2-7]{16,64}$/i).optional(),
  totp_pending_secret: z.string().regex(/^[A-Z2-7]{16,64}$/i).optional(),
});

export type LocalImage = z.infer<typeof imageSchema>;
export type LocalTag = z.infer<typeof tagSchema>;
export type GalleryData = z.infer<typeof gallerySchema>;
export type AuditEntry = z.infer<typeof auditSchema>;

const dataRoot = path.join(process.cwd(), "data");
const publicRoot = path.resolve(process.cwd(), "public");
if (dataRoot === publicRoot || dataRoot.startsWith(`${publicRoot}${path.sep}`)) {
  throw new Error("Local gallery data must be outside public/.");
}

const dbPath = path.join(dataRoot, "gallery.json");
const filesPath = path.join(dataRoot, "images");
let writeQueue: Promise<void> = Promise.resolve();

function isWithin(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export async function ensureGalleryStorage() {
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  const actualDataRoot = await realpath(dataRoot);
  let actualPublicRoot = publicRoot;
  try {
    actualPublicRoot = await realpath(publicRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (isWithin(actualPublicRoot, actualDataRoot)) {
    throw new Error("Local gallery data must be outside public/.");
  }
  await mkdir(filesPath, { recursive: true, mode: 0o700 });
  const actualFilesPath = await realpath(filesPath);
  if (!isWithin(actualDataRoot, actualFilesPath)) {
    throw new Error("Local gallery storage paths must remain outside public/ and images/ must stay inside data/.");
  }
}

async function writeData(data: GalleryData) {
  await ensureGalleryStorage();
  const temporary = path.join(dataRoot, `gallery.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporary, dbPath);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function readGallery(): Promise<GalleryData> {
  await ensureGalleryStorage();
  try {
    const raw = await readFile(dbPath, "utf8");
    const result = gallerySchema.safeParse(JSON.parse(raw));
    if (!result.success) {
      console.error("Local gallery JSON failed validation", result.error.issues);
      throw new Error("Local gallery data is invalid");
    }
    return result.data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const initial: GalleryData = {
      version: 1,
      admins: [runtimeConfig.LOCAL_ADMIN_USERNAME.toLowerCase()],
      images: [],
      tags: [],
      login_attempts: {},
      audit_log: [],
    };
    await writeData(initial);
    return initial;
  }
}

export async function mutateGallery<T>(mutator: (data: GalleryData) => T | Promise<T>): Promise<T> {
  const run = writeQueue.then(async () => {
    const data = await readGallery();
    const result = await mutator(data);
    await writeData(data);
    return result;
  });
  writeQueue = run.then(() => undefined, () => undefined);
  return run;
}

export function imageFilePath(id: string, variant: "full" | "thumbnail") {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Invalid image id");
  }
  return path.join(filesPath, `${id}-${variant}.webp`);
}

export async function appendAudit(entry: Omit<AuditEntry, "id" | "at">) {
  await mutateGallery((data) => {
    recordAudit(data, entry);
  });
}

export function recordAudit(data: GalleryData, entry: Omit<AuditEntry, "id" | "at">) {
  data.audit_log.push({ ...entry, id: randomUUID(), at: new Date().toISOString() });
  if (data.audit_log.length > 10_000) data.audit_log.splice(0, data.audit_log.length - 10_000);
}

export async function saveFailedLogin(userHash: string, ipHash: string, now = Date.now()) {
  return mutateGallery((data) => {
    for (const [hash, attempt] of Object.entries(data.login_attempts)) {
      if (now - attempt.window_started_at >= 24 * 60 * 60_000) delete data.login_attempts[hash];
    }
    const previous = data.login_attempts[userHash];
    const isLocked = previous?.locked_until !== undefined && previous.locked_until > now;
    let lockedUntil: number | undefined;
    if (isLocked) {
      lockedUntil = previous.locked_until;
    } else if (!previous || now - previous.window_started_at >= 15 * 60_000) {
      data.login_attempts[userHash] = { count: 1, window_started_at: now };
    } else {
      const count = previous.count + 1;
      lockedUntil = count >= 5 ? now + 15 * 60_000 : undefined;
      data.login_attempts[userHash] = {
        count: Math.min(count, 5),
        window_started_at: previous.window_started_at,
        locked_until: lockedUntil,
      };
    }
    recordAudit(data, {
      actor: "anonymous",
      action: "login.failure",
      user_hash: userHash,
      ip_hash: ipHash,
    });
    return lockedUntil ?? (isLocked ? previous?.locked_until : undefined);
  });
}

export async function clearLoginFailures(userHash: string, ipHash: string, username: string) {
  await mutateGallery((data) => {
    delete data.login_attempts[userHash];
    recordAudit(data, {
      actor: username,
      action: "login.success",
      user_hash: userHash,
      ip_hash: ipHash,
    });
  });
}
