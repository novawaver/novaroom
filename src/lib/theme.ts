export type ThemeChoice = "system" | "light" | "dark"

const THEME_KEY = "novaroom.theme"

export function readTheme(): ThemeChoice {
  const value = localStorage.getItem(THEME_KEY)
  if (value === "light" || value === "dark" || value === "system") return value
  return "system"
}

export function applyTheme(choice: ThemeChoice) {
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches
  const dark = choice === "dark" || (choice === "system" && systemDark)
  document.documentElement.dataset.theme = dark ? "dark" : "light"
}

export function applyStoredTheme() {
  applyTheme(readTheme())
}

export function writeTheme(choice: ThemeChoice) {
  localStorage.setItem(THEME_KEY, choice)
  applyTheme(choice)
}
