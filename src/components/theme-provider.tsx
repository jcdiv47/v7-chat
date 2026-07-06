"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { dark as clerkDark } from "@clerk/themes";

type ThemeContextValue = { dark: boolean; toggle: () => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Owns the app's dark/light state and keeps everything that renders off it in
 * sync: the `dark` class on <html> (set pre-paint by the inline script in the
 * root layout), localStorage, and Clerk — whose components only follow our
 * theme when we hand `ClerkProvider` a matching `appearance.theme`.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(false);

  // The pre-paint script decides the initial theme from localStorage / OS
  // preference; adopt whatever it already put on <html>.
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      try {
        localStorage.setItem("theme", next ? "dark" : "light");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ dark, toggle }}>
      <ClerkProvider appearance={{ theme: dark ? clerkDark : undefined }}>
        {children}
      </ClerkProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
