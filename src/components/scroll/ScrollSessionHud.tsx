import { Button } from "@/components/ui/button";
import type { ScrollSessionState } from "@/lib/scroll-session";
import { useI18n } from "@/i18n/useI18n";

type ScrollSessionHudProps = {
  frameCount: number;
  state: ScrollSessionState;
  isScrolling: boolean;
  rect?: { width: number; height: number } | null;
  onConfirm?: () => void;
  onFinish: () => void;
  onCancel: () => void;
};

export function ScrollSessionHud({
  frameCount,
  state,
  isScrolling,
  rect,
  onConfirm,
  onFinish,
  onCancel,
}: ScrollSessionHudProps) {
  const { t } = useI18n();

  // STITCHING state — minimal spinner
  if (state === "stitching") {
    return (
      <div className="flex h-full items-center justify-center gap-2 bg-card px-3">
        <svg className="animate-spin size-3.5 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span className="text-xs text-muted-foreground">{t("app.scroll.stitching")}</span>
      </div>
    );
  }

  // CONFIRMING state — show dimensions + Start/Cancel
  if (state === "confirming") {
    return (
      <div className="flex h-full items-center gap-2 bg-card px-3">
        {rect && (
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
            {Math.round(rect.width)}×{Math.round(rect.height)}
          </span>
        )}
        <span className="ml-1 text-[11px] text-muted-foreground text-pretty">
          {t("app.scroll.shortcutsHint")}
        </span>
        <div className="flex items-center gap-1.5 ml-auto">
          <Button
            size="sm"
            variant="cta"
            className="h-7 px-3 text-xs"
            onClick={onConfirm}
          >
            {t("app.scroll.confirmStart")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={onCancel}
          >
            ✕
          </Button>
        </div>
      </div>
    );
  }

  // CAPTURING state — status + Finish/Cancel
  return (
    <div className="flex h-full items-center gap-3 bg-card px-3">
      <div className="flex flex-col leading-tight">
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`size-2 rounded-full ${
              isScrolling
                ? "bg-amber-400 animate-pulse"
                : frameCount > 0
                  ? "bg-green-400"
                  : "bg-muted-foreground"
            }`}
          />
          <span className="text-xs font-medium tabular-nums">
            {isScrolling
              ? t("app.scroll.scrolling")
              : t("app.scroll.frameCount", { count: String(frameCount) })}
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground text-pretty">
          {t("app.scroll.shortcutsHint")}
        </span>
      </div>

      <div className="flex items-center gap-1.5 ml-auto">
        <Button
          size="sm"
          variant="cta"
          className="h-7 px-3 text-xs"
          onClick={onFinish}
          disabled={frameCount < 2}
        >
          ✓ {t("app.scroll.finish")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={onCancel}
        >
          ✕
        </Button>
      </div>
    </div>
  );
}
