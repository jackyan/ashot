import { useState, useEffect, useCallback } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Folder, Languages } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BackgroundImageSelector } from "./BackgroundImageSelector";
import { KeyboardShortcutManager } from "./KeyboardShortcutManager";
import type { KeyboardShortcut } from "./KeyboardShortcutManager";
import { useI18n } from "@/i18n/useI18n";
import type { AppLanguage } from "@/i18n/provider";
import type { HotkeyHealthSnapshot } from "@/lib/hotkey-health";

interface PreferencesPageProps {
  onBack: () => void;
  onSettingsChange?: () => void;
  shortcuts?: KeyboardShortcut[];
  hotkeyHealth?: HotkeyHealthSnapshot;
}

interface GeneralSettings {
  saveDir: string;
  language: AppLanguage;
}

export function PreferencesPage({ onBack, onSettingsChange, shortcuts, hotkeyHealth }: PreferencesPageProps) {
  const { language, setLanguage, t } = useI18n();
  const [settings, setSettings] = useState<GeneralSettings>({
    saveDir: "",
    language,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [saveDirError, setSaveDirError] = useState<string | null>(null);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const store = await Store.load("settings.json");
        const saveDir = await store.get<string>("saveDir");
        const storedLanguage = await store.get<AppLanguage>("language");

        setSettings({
          saveDir: saveDir || "",
          language: storedLanguage === "zh-CN" || storedLanguage === "en" ? storedLanguage : language,
        });
      } catch (err) {
        console.error("Failed to load settings:", err);
      } finally {
        setIsLoading(false);
      }
    };
    void loadSettings();
  }, [language]);

  const saveSetting = useCallback(async <K extends keyof GeneralSettings>(
    key: K,
    value: GeneralSettings[K],
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    try {
      const store = await Store.load("settings.json");
      await store.set(key, value);
      await store.save();
      onSettingsChange?.();
    } catch (err) {
      console.error(`Failed to save ${String(key)}:`, err);
      toast.error(t("preferences.toast.saveFailed"));
    }
  }, [onSettingsChange, t]);

  const handlePickDirectory = useCallback(async () => {
    setSaveDirError(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: settings.saveDir || undefined,
      });

      if (!selected || Array.isArray(selected)) return;

      await invoke("validate_save_directory", { path: selected });
      await saveSetting("saveDir", selected);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveDirError(message || t("preferences.toast.dirInvalid"));
      toast.error(t("preferences.toast.dirInvalid"), {
        description: message,
      });
    }
  }, [saveSetting, settings.saveDir, t]);

  const handleLanguageChange = useCallback(async (nextLanguage: AppLanguage) => {
    await setLanguage(nextLanguage);
    await saveSetting("language", nextLanguage);
  }, [saveSetting, setLanguage]);

  const handleShortcutsChange = useCallback((_shortcuts: KeyboardShortcut[]) => {
    onSettingsChange?.();
  }, [onSettingsChange]);

  const handleImageSelect = useCallback(async (_imageSrc: string) => {
    onSettingsChange?.();
  }, [onSettingsChange]);

  if (isLoading) {
    return (
      <main className="min-h-dvh flex items-center justify-center bg-background">
        <div className="text-muted-foreground">{t("preferences.loading")}</div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh overflow-y-auto bg-background text-foreground">
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex items-center gap-4 pb-2 border-b border-border">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground hover:bg-secondary"
            aria-label={t("common.back")}
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{t("preferences.title")}</h1>
            <p className="text-muted-foreground text-sm">{t("preferences.subtitle")}</p>
          </div>
        </div>

        <Card className="bg-card border-border">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold text-card-foreground">{t("preferences.general")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="save-dir" className="text-sm font-medium text-foreground flex items-center gap-2">
                <Folder className="size-4" aria-hidden="true" />
                {t("preferences.saveDir")}
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="save-dir"
                  type="text"
                  value={settings.saveDir}
                  readOnly
                  onClick={() => void handlePickDirectory()}
                  placeholder={t("preferences.saveDirPlaceholder")}
                  className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-card-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all font-mono text-sm cursor-pointer"
                />
                <Button
                  type="button"
                  variant="cta"
                  size="lg"
                  onClick={() => void handlePickDirectory()}
                  aria-label={t("preferences.selectFolder")}
                >
                  {t("preferences.selectFolder")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("preferences.saveDirHint")}</p>
              {saveDirError && (
                <p className="text-xs text-red-400 text-pretty">{saveDirError}</p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="language" className="text-sm font-medium text-foreground flex items-center gap-2">
                <Languages className="size-4" aria-hidden="true" />
                {t("preferences.language")}
              </label>
              <select
                id="language"
                value={settings.language}
                onChange={(event) => {
                  const next = event.target.value as AppLanguage;
                  void handleLanguageChange(next);
                }}
                className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-card-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all text-sm"
              >
                <option value="en">{t("preferences.lang.en")}</option>
                <option value="zh-CN">{t("preferences.lang.zh-CN")}</option>
              </select>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold text-card-foreground">{t("preferences.defaultBackground")}</CardTitle>
          </CardHeader>
          <CardContent>
            <BackgroundImageSelector onImageSelect={handleImageSelect} />
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold text-card-foreground">{t("preferences.shortcuts")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <KeyboardShortcutManager
              onShortcutsChange={handleShortcutsChange}
              shortcuts={shortcuts}
              health={hotkeyHealth}
            />

            <div className="space-y-3 pt-4 border-t border-border">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-3">{t("preferences.editor")}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("common.save")}</span>
                    <kbd className="px-2 py-1 bg-secondary border border-border rounded text-foreground font-mono text-xs tabular-nums">⌘S</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("common.copy")}</span>
                    <kbd className="px-2 py-1 bg-secondary border border-border rounded text-foreground font-mono text-xs tabular-nums">⇧⌘C</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Undo</span>
                    <kbd className="px-2 py-1 bg-secondary border border-border rounded text-foreground font-mono text-xs tabular-nums">⌘Z</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Redo</span>
                    <kbd className="px-2 py-1 bg-secondary border border-border rounded text-foreground font-mono text-xs tabular-nums">⇧⌘Z</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Delete annotation</span>
                    <kbd className="px-2 py-1 bg-secondary border border-border rounded text-foreground font-mono text-xs tabular-nums">⌫</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Close editor</span>
                    <kbd className="px-2 py-1 bg-secondary border border-border rounded text-foreground font-mono text-xs tabular-nums">Esc</kbd>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold text-card-foreground">{t("preferences.about")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium text-foreground">Better Shot</p>
              <p className="text-xs text-muted-foreground">Version {__APP_VERSION__}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
