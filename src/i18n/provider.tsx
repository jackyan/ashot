import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { enMessages } from "./messages/en";
import { zhCNMessages } from "./messages/zh-CN";

export type AppLanguage = "en" | "zh-CN";

type I18nContextValue = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => Promise<void>;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const FALLBACK_LANGUAGE: AppLanguage = "en";
const messages: Record<AppLanguage, Record<string, string>> = {
  en: enMessages,
  "zh-CN": zhCNMessages,
};

export function normalizeLanguage(input?: string | null): AppLanguage {
  if (!input) return FALLBACK_LANGUAGE;
  const lower = input.toLowerCase();
  if (lower.startsWith("zh")) return "zh-CN";
  return "en";
}

export function resolveLanguagePreference(
  saved?: string | null,
  systemLanguage?: string | null,
): AppLanguage {
  if (saved === "en" || saved === "zh-CN") {
    return saved;
  }
  return normalizeLanguage(systemLanguage);
}

function applyVariables(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return Object.entries(vars).reduce((acc, [key, value]) => {
    return acc.split(`{${key}}`).join(String(value));
  }, template);
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(() => {
    if (typeof window === "undefined") return FALLBACK_LANGUAGE;
    return normalizeLanguage(window.navigator.language);
  });

  useEffect(() => {
    let mounted = true;
    const loadLanguage = async () => {
      try {
        const store = await Store.load("settings.json");
        const saved = await store.get<string>("language");
        if (!mounted) return;
        setLanguageState(resolveLanguagePreference(saved, window.navigator.language));
      } catch {
        if (!mounted) return;
        setLanguageState(resolveLanguagePreference(undefined, window.navigator.language));
      }
    };
    loadLanguage();
    return () => {
      mounted = false;
    };
  }, []);

  const setLanguage = useCallback(async (next: AppLanguage) => {
    setLanguageState(next);
    try {
      const store = await Store.load("settings.json");
      await store.set("language", next);
      await store.save();
    } catch (error) {
      console.error("Failed to persist language:", error);
    }
  }, []);

  const t = useCallback((key: string, vars?: Record<string, string | number>) => {
    const template = messages[language][key] ?? messages[FALLBACK_LANGUAGE][key] ?? key;
    return applyVariables(template, vars);
  }, [language]);

  const value = useMemo<I18nContextValue>(() => ({
    language,
    setLanguage,
    t,
  }), [language, setLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18nContext() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18nContext must be used within I18nProvider");
  }
  return context;
}
