"use client";

import { useEffect, useState } from "react";

import { applyTheme, storedTheme, type ThemeChoice } from "@/lib/theme";

const OPTIONS: { value: ThemeChoice; label: string; glyph: string }[] = [
  { value: "light", label: "Light", glyph: "☀" },
  { value: "dark", label: "Dark", glyph: "☾" },
  { value: "system", label: "Match my system", glyph: "◐" },
];

/**
 * Three states rather than a switch, because "follow the system" is a real
 * answer and not the absence of one -- somebody whose machine goes dark in the
 * evening wants this to go with it.
 *
 * Small on purpose. It is set once and then lived with, so it earns a corner
 * rather than a row.
 */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  // The real value lives on <html>, put there before paint. Reading it after
  // mount keeps the server's markup and the first client render identical.
  useEffect(() => setChoice(storedTheme()), []);

  // On "system", the machine can change its mind while the page is open.
  useEffect(() => {
    if (choice !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => applyTheme("system");
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [choice]);

  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={choice === option.value ? "is-on" : ""}
          aria-pressed={choice === option.value}
          title={option.label}
          onClick={() => {
            setChoice(option.value);
            applyTheme(option.value);
          }}
        >
          <span aria-hidden>{option.glyph}</span>
          <span className="sr-only">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
