import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminLoginPath } from "@/lib/runtime-config";
import { logServerError } from "@/lib/server-logging";

type AdminContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: User;
};

export type AdminApiAuthorization =
  | { context: AdminContext; response?: never }
  | { context?: never; response: NextResponse };

async function loadAdminContext(): Promise<AdminContext | null> {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) {
      logServerError("Admin session verification failed", authError);
      return null;
    }
    if (!user) return null;

    const { data: isAdmin, error: roleError } = await supabase.rpc("is_gallery_admin");
    if (roleError) {
      logServerError("Admin role verification failed", roleError);
      return null;
    }
    if (isAdmin !== true) return null;
    return { supabase, user };
  } catch (error) {
    logServerError("Admin authorization is unavailable", error);
    return null;
  }
}

export async function requireAdminSession() {
  const context = await loadAdminContext();
  if (!context) redirect(getAdminLoginPath());
  return context;
}

export async function authorizeAdminApi(): Promise<AdminApiAuthorization> {
  const context = await loadAdminContext();
  if (!context) {
    return { response: NextResponse.json({ error: "Não autorizado." }, { status: 401 }) };
  }

  try {
    const { data: assurance, error } = await context.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) {
      logServerError("Admin MFA verification failed", error);
      return { response: NextResponse.json({ error: "Não autorizado." }, { status: 403 }) };
    }
    if (assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {
      return { response: NextResponse.json({ error: "Não autorizado." }, { status: 403 }) };
    }
  } catch (error) {
    logServerError("Admin MFA verification is unavailable", error);
    return { response: NextResponse.json({ error: "Não autorizado." }, { status: 403 }) };
  }

  return { context };
}
