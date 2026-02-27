import { convertFileSrc } from "@tauri-apps/api/core";
import { useMemo } from "react";
import { useI18n } from "@/i18n/useI18n";
import { getScrollPreviewPlacement } from "@/ui-workflows/capture-shell/geometry";
import type {
  ActiveMonitorContext,
  CaptureRect,
  ScrollPreviewPlacement,
} from "@/ui-workflows/capture-shell/types";

type ScrollPreviewPanelProps = {
  monitor: ActiveMonitorContext;
  rect: CaptureRect;
  previewPath: string | null;
  frameCount: number;
  isScrolling: boolean;
};

const PANEL_WIDTH = 340;
const PANEL_GAP = 12;

export function ScrollPreviewPanel({
  monitor,
  rect,
  previewPath,
  frameCount,
  isScrolling,
}: ScrollPreviewPanelProps) {
  const { t } = useI18n();

  const placement: ScrollPreviewPlacement = useMemo(
    () => getScrollPreviewPlacement(monitor, rect, PANEL_WIDTH, PANEL_GAP),
    [monitor, rect],
  );

  const panelLeft =
    placement === "right"
      ? rect.x + rect.width + PANEL_GAP
      : Math.max(monitor.x, rect.x - PANEL_WIDTH - PANEL_GAP);

  const panelTop = Math.max(monitor.y, Math.min(rect.y, monitor.y + monitor.height - 420));

  return (
    <aside
      className="pointer-events-none fixed z-50 overflow-hidden rounded-lg border border-border bg-card/95 shadow"
      style={{
        left: panelLeft,
        top: panelTop,
        width: PANEL_WIDTH,
        maxHeight: Math.max(280, monitor.height - 32),
      }}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted-foreground">
        <span>{t("app.scroll.previewTitle")}</span>
        <span className="tabular-nums">
          {isScrolling ? t("app.scroll.scrolling") : t("app.scroll.frameCount", { count: String(frameCount) })}
        </span>
      </div>

      <div className="max-h-[360px] overflow-auto bg-secondary/30 p-2">
        {previewPath ? (
          <img
            src={convertFileSrc(previewPath)}
            alt={t("app.scroll.previewTitle")}
            className="h-auto w-full rounded border border-border bg-background"
            draggable={false}
          />
        ) : (
          <div className="flex min-h-32 items-center justify-center rounded border border-dashed border-border bg-secondary text-xs text-muted-foreground text-pretty">
            {t("app.scroll.previewWaiting")}
          </div>
        )}
      </div>
    </aside>
  );
}
