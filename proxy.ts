import { NextResponse, type NextRequest } from "next/server";
import { getAdminLoginPath, runtimeConfig } from "@/lib/runtime-config";
import { verifyLocalSessionToken } from "@/lib/local-auth";

const SESSION_COOKIE = "lum_admin_session";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const loginPath = getAdminLoginPath();
  const isLoginPage = pathname === loginPath;
  const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");
  const isAdminApi = pathname === "/api/admin" || pathname.startsWith("/api/admin/");
  const isProtected = isAdminPage || isAdminApi;
  if (!isLoginPage && !isProtected) return NextResponse.next();
  const hostname = request.nextUrl.hostname.toLowerCase();
  const localHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

  if (!localHost) {
    if (isAdminApi) return addPrivateHeaders(NextResponse.json({ error: "Não autorizado." }, { status: 403 }));
    return addPrivateHeaders(NextResponse.next({ request }));
  }

  if (isLoginPage) {
    return addPrivateHeaders(NextResponse.next());
  }
  const forwardedHeaders = new Headers(request.headers);

  let session = null;
  if (runtimeConfig.NODE_ENV !== "production") {
    try {
      session = await verifyLocalSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
    } catch (error) {
      if (runtimeConfig.NODE_ENV === "development") {
        console.error("Local admin proxy verification failed", error);
      }
    }
  }

  if (!session) {
    if (isAdminApi) {
      return addPrivateHeaders(NextResponse.json({ error: "Não autorizado." }, { status: 401 }));
    }
    // The protected server layout converts this unauthenticated request into the site's 404.
    return addPrivateHeaders(NextResponse.next({ request: { headers: forwardedHeaders } }));
  }

  return addPrivateHeaders(NextResponse.next({ request: { headers: forwardedHeaders } }));
}

function addPrivateHeaders(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

export const config = {
  matcher: ["/:path*"],
};
