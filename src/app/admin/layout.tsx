import type { Metadata } from "next";
import { requireLocalAdminPage } from "@/lib/local-auth";

export const metadata: Metadata = {
  robots: { index: false, follow: false, noarchive: true },
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AdminGate>{children}</AdminGate>;
}

async function AdminGate({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireLocalAdminPage();
  return children;
}
