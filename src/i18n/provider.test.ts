import { describe, expect, it } from "vitest";
import { normalizeLanguage, resolveLanguagePreference } from "./provider";

describe("i18n language resolution", () => {
  it("maps zh locale to zh-CN", () => {
    expect(normalizeLanguage("zh-Hans-CN")).toBe("zh-CN");
  });

  it("falls back to en for non-zh locales", () => {
    expect(normalizeLanguage("fr-FR")).toBe("en");
  });

  it("uses saved language preference first", () => {
    expect(resolveLanguagePreference("zh-CN", "en-US")).toBe("zh-CN");
    expect(resolveLanguagePreference("en", "zh-CN")).toBe("en");
  });

  it("uses system language when no saved preference", () => {
    expect(resolveLanguagePreference(undefined, "zh-CN")).toBe("zh-CN");
    expect(resolveLanguagePreference(null, "en-US")).toBe("en");
  });
});
