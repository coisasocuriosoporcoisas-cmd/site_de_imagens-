import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SecretLogin } from "@/components/secret-login";
import { isLocalHostRequest } from "@/lib/local-auth";
import { readGallery } from "@/lib/local-gallery";
import { runtimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  robots: { index: false, follow: false, noarchive: true },
};

export default async function SecretLoginRoute({
  params,
  searchParams,
}: {
  params: Promise<{ loginPath: string }>;
  searchParams: Promise<{ status?: string; minutes?: string }>;
}) {
  const { loginPath } = await params;
  if (runtimeConfig.NODE_ENV === "production" || loginPath !== runtimeConfig.ADMIN_LOGIN_PATH.slice(1) || !await isLocalHostRequest()) notFound();
  const gallery = await readGallery();
  return <SecretLogin searchParams={searchParams} totpRequired={Boolean(gallery.totp_secret)}/>;
}
