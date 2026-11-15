import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "lum. — galeria visual", template: "%s — lum." },
  description: "Uma coleção independente de imagens para inspirar novas ideias.",
  openGraph: {
    type: "website",
    siteName: "lum.",
    title: "lum. — galeria visual",
    description: "Uma coleção independente de imagens para inspirar novas ideias.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR" suppressHydrationWarning>
    <body>{children}</body>
  </html>;
}
