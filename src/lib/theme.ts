/**
 * Light, dark, or whatever the machine says.
 *
 * The choice is stamped onto <html> as `data-theme`, always resolved to a
 * concrete "light" or "dark" -- the stylesheet then needs one set of dark
 * tokens under one selector, rather than a second copy under a media query
 * that has to be kept in step by hand.
 *
 * It is applied by a blocking script in the document head rather than by React,
 * because a theme decided after hydration is a white page that turns dark while
 * you are looking at it.
 */

export type ThemeChoice = "light" | "dark" | "system";

export const THEME_KEY = "emailpreviews:theme";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Runs before first paint, so it is written to be small and to fail quietly:
 * storage can throw in a private window, and a page in the wrong theme is a far
 * better outcome than a page that does not render.
 */
export const THEME_SCRIPT = `try{
var c=localStorage.getItem(${JSON.stringify(THEME_KEY)})||"system";
var d=c==="dark"||(c!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.dataset.theme=d?"dark":"light";
document.documentElement.dataset.themeChoice=c;
}catch(e){}`;

/** Apply a choice now, and remember it. Mirrors what the head script does. */
export function applyTheme(choice: ThemeChoice): void {
  const dark =
    choice === "dark" ||
    (choice !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.themeChoice = choice;
  try {
    window.localStorage.setItem(THEME_KEY, choice);
  } catch {
    // The preference is lost on the next visit; the page is still right now.
  }
}

export function storedTheme(): ThemeChoice {
  const held = document.documentElement.dataset.themeChoice;
  return isThemeChoice(held) ? held : "system";
}
