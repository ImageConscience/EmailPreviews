"use client";

import { useEffect, useRef } from "react";

/**
 * Renders merged email HTML in an isolated frame.
 *
 * The frame is sandboxed without `allow-scripts`, so nothing in an uploaded
 * template can execute. `allow-same-origin` is kept only so the parent can
 * write the document directly instead of swapping `srcdoc` -- that lets the
 * scroll position survive a re-render, which matters when you are editing a
 * field near the bottom of a long email. Link clicks are intercepted here and
 * opened in a new tab so a stray click cannot replace the preview.
 */
export function PreviewFrame({ html, maxWidth }: { html: string; maxWidth: number | null }) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = ref.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) return;

    const previousScroll = doc.scrollingElement?.scrollTop ?? 0;
    doc.open();
    doc.write(html);
    doc.close();

    const restore = requestAnimationFrame(() => {
      const scroller = iframe.contentDocument?.scrollingElement;
      if (scroller) scroller.scrollTop = previousScroll;
    });

    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const anchor = target?.closest?.("a");
      if (!anchor) return;
      event.preventDefault();
      const href = anchor.getAttribute("href");
      if (href && !href.startsWith("#") && !href.startsWith("{{")) {
        window.open(href, "_blank", "noopener,noreferrer");
      }
    };

    const written = iframe.contentDocument;
    written?.addEventListener("click", onClick);
    return () => {
      cancelAnimationFrame(restore);
      written?.removeEventListener("click", onClick);
    };
  }, [html]);

  return (
    <div className="ws-frame" style={{ maxWidth: maxWidth ? `${maxWidth}px` : "100%" }}>
      <iframe ref={ref} sandbox="allow-same-origin" title="Email preview" />
    </div>
  );
}
