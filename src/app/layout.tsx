import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  // Pages set their own full title including the " · Thrum" suffix, rather than
  // using a `template` here -- a template would append it a second time.
  title: "Thrum",
  description:
    "Self-hosted team chat: realtime channels, direct messages, threads and full-text search.",
  applicationName: "Thrum",
  // A private chat server has no business being indexed.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
