import { isAppLocale, type AppLocale } from "./i18n";

export type AppTheme = "dark" | "light";

export interface AppPreferences {
  locale: AppLocale;
  theme: AppTheme;
}

interface PreferencesStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export const APP_PREFERENCES_STORAGE_KEY = "render-viewer-3d.preferences.v1";

export const DEFAULT_APP_PREFERENCES: Readonly<AppPreferences> = Object.freeze({
  locale: "ja",
  theme: "dark",
});

export function loadAppPreferences(
  storage: PreferencesStorage | undefined = getBrowserStorage(),
): AppPreferences {
  if (!storage) return { ...DEFAULT_APP_PREFERENCES };

  try {
    const serialized = storage.getItem(APP_PREFERENCES_STORAGE_KEY);
    if (!serialized) return { ...DEFAULT_APP_PREFERENCES };
    const candidate = JSON.parse(serialized) as Partial<AppPreferences>;
    return {
      locale: isAppLocale(candidate.locale)
        ? candidate.locale
        : DEFAULT_APP_PREFERENCES.locale,
      theme: isAppTheme(candidate.theme)
        ? candidate.theme
        : DEFAULT_APP_PREFERENCES.theme,
    };
  } catch {
    return { ...DEFAULT_APP_PREFERENCES };
  }
}

export function saveAppPreferences(
  preferences: AppPreferences,
  storage: PreferencesStorage | undefined = getBrowserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(APP_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Storage can be unavailable in privacy modes; the in-memory setting remains valid.
  }
}

export function toggleLocale(locale: AppLocale): AppLocale {
  return locale === "ja" ? "en" : "ja";
}

export function toggleTheme(theme: AppTheme): AppTheme {
  return theme === "dark" ? "light" : "dark";
}

function isAppTheme(value: unknown): value is AppTheme {
  return value === "dark" || value === "light";
}

function getBrowserStorage(): PreferencesStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
