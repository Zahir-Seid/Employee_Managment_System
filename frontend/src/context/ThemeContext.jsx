import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";

// App-wide light/dark theme.
//  - First visit follows the OS setting (prefers-color-scheme); once the user
//    uses the top-bar toggle, their choice is saved in localStorage and wins.
//  - The live TV Display kiosk (/tv-display) is a shared unattended office
//    screen, so it is ALWAYS rendered light regardless of the toggle. The
//    admin TV Display Settings page (/tv-display-settings) is a normal page
//    and follows the toggle.
// The same logic runs once in index.html before first paint (no flash).
const STORAGE_KEY = "ems.theme";

const ThemeContext = createContext(null);

function readStored() {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

function systemTheme() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function isTvKiosk(pathname) {
  return pathname === "/tv-display" || pathname.startsWith("/tv-display/");
}

export function ThemeProvider({ children }) {
  const { pathname } = useLocation();
  const [stored, setStored] = useState(readStored);
  const [system, setSystem] = useState(systemTheme);

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const theme = stored ?? system;
  const forceLight = isTvKiosk(pathname);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark" && !forceLight);
    if (forceLight) root.setAttribute("data-tv", "");
    else root.removeAttribute("data-tv");
  }, [theme, forceLight]);

  const setTheme = useCallback((next) => {
    setStored(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* Non-critical: the choice just won't persist. */
    }
  }, []);

  const toggleTheme = useCallback(() => setTheme(theme === "dark" ? "light" : "dark"), [theme, setTheme]);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
