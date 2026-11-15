import { readFile } from "node:fs/promises";

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

function parseEnv(contents) {
  const values = new Map();
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

function unwrap(raw = "") {
  const pairedQuotes = (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"));
  return { pairedQuotes, value: pairedQuotes ? raw.slice(1, -1) : raw };
}

function errorCause(error) {
  let cause = error;
  while (cause?.cause) cause = cause.cause;
  return {
    code: cause?.code ?? error?.code ?? "UNKNOWN",
    message: cause?.message ?? error?.message ?? "unknown error",
  };
}

async function probe(label, url, init = {}, options = {}) {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(7000) });
    let apiCode;
    if (!response.ok) {
      try {
        const body = await response.json();
        apiCode = body.code ?? body.error ?? body.message;
      } catch {
        apiCode = undefined;
      }
    }
    console.log(`${label}: HTTP ${response.status}${apiCode ? `; API=${String(apiCode).slice(0, 100)}` : ""}`);
    if (!response.ok && !(options.allowUnauthorized && response.status === 401)) probeFailures = true;
    return { response, apiCode };
  } catch (error) {
    probeFailures = true;
    const cause = errorCause(error);
    console.log(`${label}: fetch failed; code=${cause.code}; cause=${cause.message}`);
    return { error };
  }
}

let contents;
try {
  contents = await readFile(".env.local", "utf8");
} catch {
  console.error("Could not read .env.local. Copy .env.example and set the Supabase project values.");
  process.exit(1);
}

const rawValues = parseEnv(contents);
const values = {};
let configValid = true;
let probeFailures = false;
for (const name of required) {
  const raw = rawValues.get(name) ?? "";
  const { pairedQuotes, value } = unwrap(raw);
  const present = raw.length > 0;
  const containsWhitespace = /\s/.test(raw);
  const containsQuotes = /['"]/.test(raw);
  const trailingSlash = raw.endsWith("/");
  const placeholder = /^(?:your(?:[-_]|$)|https:\/\/your-project)/i.test(value);
  let valid = present && !containsQuotes && !containsWhitespace && !trailingSlash && !placeholder;
  if (name === "NEXT_PUBLIC_SUPABASE_URL") {
    try {
      const parsed = new URL(value);
      valid = valid && parsed.protocol === "https:" && parsed.pathname === "/" && !value.endsWith("/");
    } catch {
      valid = false;
    }
  }
  if (name === "SUPABASE_SERVICE_ROLE_KEY") {
    const isPublishable = value.startsWith("sb_publishable_");
    const isSecretKey = value.startsWith("sb_secret_");
    const isLegacyServiceRole = (() => {
      try {
        const payload = JSON.parse(Buffer.from(value.split(".")[1] ?? "", "base64url").toString("utf8"));
        return payload.role === "service_role";
      } catch {
        return false;
      }
    })();
    if (!isSecretKey && !isLegacyServiceRole) valid = false;
    console.log(`  service key type=${isSecretKey ? "sb_secret" : isLegacyServiceRole ? "legacy service_role JWT" : isPublishable ? "publishable key (wrong variable)" : "unrecognized"}`);
  }
  configValid &&= valid;
  values[name] = value;
  console.log(
    `${name}: ${present ? "present" : "missing"}; prefix=${present ? value.slice(0, 4) : "----"}; ` +
    `quotes=${pairedQuotes || containsQuotes}; whitespace=${containsWhitespace}; trailingSlash=${trailingSlash}; placeholder=${placeholder}; valid=${valid}`,
  );
}

const baseUrl = values.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
const anonKey = values.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = values.SUPABASE_SERVICE_ROLE_KEY;
if (!baseUrl || !anonKey) {
  console.error("REST/Auth/table tests skipped because URL or anon key is missing.");
  process.exit(1);
}

const anonHeaders = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
const restRoot = await probe("REST root", `${baseUrl}/rest/v1/`, { headers: anonHeaders }, { allowUnauthorized: true });
if (restRoot.response?.status === 401) {
  console.log("  REST root catalog may reject the anon key; the table-read checks below determine public access.");
}
await probe("Auth health", `${baseUrl}/auth/v1/health`, { headers: anonHeaders });

for (const table of ["images", "tags"]) {
  const result = await probe(
    `Public ${table} read`,
    `${baseUrl}/rest/v1/${table}?select=id&limit=1`,
    { headers: anonHeaders },
  );
  if (result.response?.ok) {
    console.log(`  ${table}: table exists and anonymous SELECT is permitted; an empty result is valid.`);
  } else if (result.response?.status === 404 || result.apiCode === "PGRST205") {
    console.log(`  ${table}: not found in the REST schema.`);
  } else if (result.response) {
    console.log(`  ${table}: cannot confirm existence/read access; check the status, anon key, grants, and RLS.`);
  }
}

if (serviceKey) {
  const result = await probe("gallery bucket", `${baseUrl}/storage/v1/bucket/gallery`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (result.response?.ok) console.log("  gallery: bucket exists.");
  else if (result.response?.status === 404) console.log("  gallery: bucket does not exist.");
  else if (result.response) console.log("  gallery: cannot confirm; check project URL and server key.");
}

if (!configValid || probeFailures) process.exitCode = 1;
