import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Email Previews",
  description: "Merge content sheets into HTML email templates and preview them live.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
