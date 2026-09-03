import type { Metadata } from "next";
import { SetupNeeded } from "@/components/SetupNeeded";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Email Previews",
  description: "Merge content sheets into HTML email templates and preview them live.",
};

/**
 * scripts/start.mjs sets these when it could not reach the database, and starts
 * the server anyway so the deployment can say so at its own URL. Short-circuiting
 * here keeps every page from attempting a query that is certain to fail.
 */
function setupIssue() {
  const summary = process.env.EP_SETUP_ISSUE;
  if (!summary) return null;
  let steps: string[] = [];
  try {
    const parsed = JSON.parse(process.env.EP_SETUP_STEPS ?? "[]");
    if (Array.isArray(parsed)) steps = parsed.filter((s): s is string => typeof s === "string");
  } catch {
    /* the steps are a convenience; never let them break the page */
  }
  return { summary, detail: process.env.EP_SETUP_DETAIL ?? "", steps };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const issue = setupIssue();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Before first paint: a theme decided after hydration is a white page
            that turns dark while you are looking at it. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{issue ? <SetupNeeded {...issue} /> : children}</body>
    </html>
  );
}
