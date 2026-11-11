import type { Metadata } from "next";
import { brand } from "@/lib/navigation";
import "./globals.css";
export const metadata: Metadata = {
  title: brand + " — X workspace",
  description:
    "A private workspace for your writing, conversations, and publishing queue.",
  icons: { icon: "/favicon.svg" },
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
