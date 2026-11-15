type ErrorRecord = {
  name?: string;
  message?: string;
  code?: string;
  cause?: unknown;
};

function asErrorRecord(error: unknown): ErrorRecord {
  if (typeof error !== "object" || error === null) return { message: String(error) };
  return error as ErrorRecord;
}

export function logServerError(context: string, error: unknown) {
  const root = asErrorRecord(error);
  if (process.env.NODE_ENV !== "development") {
    console.error(context, { name: root.name, code: root.code });
    return;
  }
  let cause = root.cause;
  const seen = new Set<unknown>();
  while (cause && asErrorRecord(cause).cause && !seen.has(cause)) {
    seen.add(cause);
    cause = asErrorRecord(cause).cause;
  }
  const rootCause = cause ? asErrorRecord(cause) : undefined;
  console.error(context, {
    name: root.name,
    code: root.code,
    message: root.message,
    error,
    cause: rootCause ? {
      code: rootCause.code,
      message: rootCause.message,
    } : undefined,
  });
}
