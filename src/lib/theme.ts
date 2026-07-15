export type Theme = "dark" | "light";

const STORAGE_KEY = "clr-theme";

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore quota / private mode
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", theme === "light" ? "#f7f7f8" : "#0a0a0b");
  }
}

export function normalizeTheme(value: unknown): Theme {
  return value === "light" ? "light" : "dark";
}
