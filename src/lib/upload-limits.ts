const VERCEL_REQUEST_LIMIT_MB = 4;
const MAX_CONFIGURED_UPLOAD_MB = 50;

export function getMaxUploadMb() {
  const raw = process.env.MAX_UPLOAD_MB ?? "";
  const configured = /^\d+$/.test(raw) ? Number(raw) : 0;
  const requested = Number.isInteger(configured) && configured > 0 && configured <= MAX_CONFIGURED_UPLOAD_MB
    ? configured
    : process.env.VERCEL === "1" ? VERCEL_REQUEST_LIMIT_MB : 10;

  return process.env.VERCEL === "1"
    ? Math.min(requested, VERCEL_REQUEST_LIMIT_MB)
    : requested;
}

export const MAX_PROCESSED_IMAGE_BYTES = MAX_CONFIGURED_UPLOAD_MB * 1024 * 1024;
