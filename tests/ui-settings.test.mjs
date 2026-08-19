import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer } from "vite";

let server;
let APP_PREFERENCES_STORAGE_KEY;
let DEFAULT_APP_PREFERENCES;
let loadAppPreferences;
let saveAppPreferences;
let toggleLocale;
let toggleTheme;
let isAppLocale;
let translate;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({
    APP_PREFERENCES_STORAGE_KEY,
    DEFAULT_APP_PREFERENCES,
    loadAppPreferences,
    saveAppPreferences,
    toggleLocale,
    toggleTheme,
  } = await server.ssrLoadModule("/src/ui/app-preferences.ts"));
  ({ isAppLocale, translate } = await server.ssrLoadModule("/src/ui/i18n.ts"));
});

after(async () => {
  await server?.close();
});

describe("application preferences", () => {
  it("defaults to Japanese and dark mode", () => {
    const storage = createMemoryStorage();

    assert.deepEqual(loadAppPreferences(storage), {
      locale: "ja",
      theme: "dark",
    });
    assert.deepEqual(DEFAULT_APP_PREFERENCES, {
      locale: "ja",
      theme: "dark",
    });
  });

  it("recovers valid fields and ignores malformed storage", () => {
    const malformed = createMemoryStorage("not-json");
    assert.deepEqual(loadAppPreferences(malformed), {
      locale: "ja",
      theme: "dark",
    });

    const partial = createMemoryStorage(
      JSON.stringify({ locale: "en", theme: "unsupported" }),
    );
    assert.deepEqual(loadAppPreferences(partial), {
      locale: "en",
      theme: "dark",
    });
  });

  it("saves and toggles supported settings", () => {
    const storage = createMemoryStorage();
    saveAppPreferences({ locale: "en", theme: "light" }, storage);

    assert.deepEqual(loadAppPreferences(storage), {
      locale: "en",
      theme: "light",
    });
    assert.equal(toggleLocale("ja"), "en");
    assert.equal(toggleLocale("en"), "ja");
    assert.equal(toggleTheme("dark"), "light");
    assert.equal(toggleTheme("light"), "dark");
  });
});

describe("translations", () => {
  it("provides Japanese defaults and English alternatives", () => {
    assert.equal(isAppLocale("ja"), true);
    assert.equal(isAppLocale("en"), true);
    assert.equal(isAppLocale("fr"), false);
    assert.equal(translate("ja", "manual.title"), "簡易マニュアル");
    assert.equal(translate("en", "manual.title"), "Quick guide");
    assert.equal(translate("ja", "theme.light"), "ライト");
    assert.equal(translate("en", "theme.light"), "LIGHT");
  });
});

function createMemoryStorage(initialValue) {
  const values = new Map();
  if (initialValue !== undefined) {
    values.set(APP_PREFERENCES_STORAGE_KEY, initialValue);
  }
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}
