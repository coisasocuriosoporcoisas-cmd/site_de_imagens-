import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ADMIN_LOGIN_PATH: z.string()
    .regex(/^\/[a-zA-Z0-9][a-zA-Z0-9-]{5,80}$/, "use um caminho único iniciado por /")
    .default("/entrar-8f3k2x"),
  LOCAL_ADMIN_USERNAME: z.string().min(1).max(64).default("admin"),
  LOCAL_ADMIN_PASSWORD: z.string().optional(),
  LOCAL_TOTP_SECRET: z.string().optional(),
  MAX_UPLOAD_MB: z.string().optional(),
});

const parsed = configSchema.safeParse({
  NODE_ENV: process.env.NODE_ENV,
  ADMIN_LOGIN_PATH: process.env.ADMIN_LOGIN_PATH,
  LOCAL_ADMIN_USERNAME: process.env.LOCAL_ADMIN_USERNAME,
  LOCAL_ADMIN_PASSWORD: process.env.LOCAL_ADMIN_PASSWORD,
  LOCAL_TOTP_SECRET: process.env.LOCAL_TOTP_SECRET,
  MAX_UPLOAD_MB: process.env.MAX_UPLOAD_MB,
});

if (!parsed.success) {
  for (const issue of parsed.error.issues) {
    const name = issue.path[0] ?? "environment";
    console.error(`Invalid environment variable ${String(name)}: ${issue.message}`);
  }
  throw new Error("Invalid application environment configuration");
}

if (parsed.data.LOCAL_ADMIN_PASSWORD?.includes('"') || parsed.data.LOCAL_ADMIN_PASSWORD?.includes("'")) {
  console.error("Invalid environment variable LOCAL_ADMIN_PASSWORD: remove wrapping or embedded quotes.");
  throw new Error("Invalid application environment configuration");
}

if (parsed.data.LOCAL_TOTP_SECRET && !/^[A-Z2-7]{16,64}$/i.test(parsed.data.LOCAL_TOTP_SECRET)) {
  console.error("Invalid environment variable LOCAL_TOTP_SECRET: expected a Base32 secret.");
  throw new Error("Invalid application environment configuration");
}

if (parsed.data.MAX_UPLOAD_MB && !/^\d+$/.test(parsed.data.MAX_UPLOAD_MB)) {
  console.error("Invalid environment variable MAX_UPLOAD_MB: expected an integer from 1 to 50.");
  throw new Error("Invalid application environment configuration");
}

if (parsed.data.MAX_UPLOAD_MB) {
  const limit = Number(parsed.data.MAX_UPLOAD_MB);
  if (limit < 1 || limit > 50) {
    console.error("Invalid environment variable MAX_UPLOAD_MB: expected an integer from 1 to 50.");
    throw new Error("Invalid application environment configuration");
  }
}

export const runtimeConfig = parsed.data;

if (runtimeConfig.NODE_ENV === "development" && !runtimeConfig.LOCAL_ADMIN_PASSWORD) {
  console.warn("LOCAL_ADMIN_PASSWORD is not set; local sign-in is disabled until this variable is configured.");
}

export function getAdminLoginPath() {
  return runtimeConfig.ADMIN_LOGIN_PATH;
}

export function getLocalAdminCredentials() {
  if (runtimeConfig.NODE_ENV === "production" || !runtimeConfig.LOCAL_ADMIN_PASSWORD) return null;
  return {
    username: runtimeConfig.LOCAL_ADMIN_USERNAME.toLowerCase(),
    password: runtimeConfig.LOCAL_ADMIN_PASSWORD,
  };
}
