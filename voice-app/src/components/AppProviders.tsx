"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

/* —— Theme —— */

type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "voice-app-theme";
const THEME_CHANGE_EVENT = "voice-app-theme-change";

function readTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

function subscribeTheme(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  window.addEventListener("storage", onChange);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => {
    mq.removeEventListener("change", onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  };
}

type ThemeContextValue = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

function applyThemeClass(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(
    subscribeTheme,
    readTheme,
    () => "light" as Theme,
  );

  useLayoutEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, t);
    } catch {
      /* ignore quota / private mode */
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(readTheme() === "dark" ? "light" : "dark");
  }, [setTheme]);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/* —— Toast —— */

type ToastContextValue = {
  showToast: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const TOAST_MS = 6000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setVisible(true);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => {
      setVisible(false);
    }, TOAST_MS);
    return () => window.clearTimeout(t);
  }, [toast]);

  const onTransitionEnd = () => {
    if (!visible) setToast(null);
  };

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6"
        aria-live="assertive"
        aria-atomic="true"
      >
        {toast ? (
          <div
            role="alert"
            onTransitionEnd={onTransitionEnd}
            className={`pointer-events-auto max-w-md rounded-xl border px-4 py-3 text-sm shadow-lg transition-[opacity,transform] duration-200 ease-out dark:border-red-900/60 dark:bg-red-950/95 dark:text-red-100 border-red-200 bg-red-50 text-red-900 ${
              visible
                ? "translate-y-0 opacity-100"
                : "translate-y-2 opacity-0"
            }`}
          >
            {toast}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>{children}</ToastProvider>
    </ThemeProvider>
  );
}
