"use client";

import { useState } from "react";

/**
 * Copy the address of the current view.
 *
 * The address bar already holds everything, but nobody thinks to look there for
 * a filtered view -- a button beside the filters is what makes it occur to
 * someone that this is a thing they can send.
 */
export function ShareLink({ label = "Copy link" }: { label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="btn btn-sm"
      title="Copy a link to exactly this view — filters, dates and all"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // Clipboard blocked; the address bar still has it.
        }
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
