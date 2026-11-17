import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
type Theme = "system" | "light" | "dark";
const ThemeContext = createContext<
  { theme: Theme; resolved: "light" | "dark"; setTheme: (theme: Theme) => void } | undefined
>(undefined);
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem("abra-theme");
      return saved === "light" || saved === "dark" ? saved : "system";
    } catch {
      return "system";
    }
  });
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const changed = () => setSystemDark(media.matches);
    const stored = (event: StorageEvent) => {
      if (event.key !== "abra-theme" && event.key !== null) return;
      setTheme(event.newValue === "light" || event.newValue === "dark" ? event.newValue : "system");
    };
    media.addEventListener("change", changed);
    window.addEventListener("storage", stored);
    return () => {
      media.removeEventListener("change", changed);
      window.removeEventListener("storage", stored);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.classList.toggle("dark", resolved === "dark");
    try {
      localStorage.setItem("abra-theme", theme);
    } catch {
      /* Theme still works without persistence. */
    }
  }, [theme, resolved]);
  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>
  );
}
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("ThemeProvider is required");
  return context;
}
