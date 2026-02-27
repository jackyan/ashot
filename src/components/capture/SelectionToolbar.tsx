import {
  Check,
  Highlighter,
  Pencil,
  ScanLine,
  ScanText,
  ScrollText,
  TextCursor,
  X,
} from "lucide-react";
import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/useI18n";
import type { CaptureRect } from "@/ui-workflows/capture-shell/types";

export type QuickTool = "arrow" | "brush" | "mosaic" | "text";

type SelectionToolbarProps = {
  rect: CaptureRect;
  scrollCapturing: boolean;
  onToolChange: (tool: QuickTool) => void;
  onRunOcr: () => void;
  onStartScroll: () => void;
  onFinish: () => void;
  onCancel: () => void;
};

const TOOL_ITEMS: Array<{ id: QuickTool; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: "arrow", label: "Arrow", icon: Highlighter },
  { id: "brush", label: "Brush", icon: Pencil },
  { id: "mosaic", label: "Mosaic", icon: ScanLine },
  { id: "text", label: "Text", icon: TextCursor },
];

export function SelectionToolbar({
  rect,
  scrollCapturing,
  onToolChange,
  onRunOcr,
  onStartScroll,
  onFinish,
  onCancel,
}: SelectionToolbarProps) {
  const { t } = useI18n();

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
        <div className="hidden text-xs text-muted-foreground tabular-nums sm:block">
          {Math.round(rect.width)} × {Math.round(rect.height)}
        </div>

        <div className="flex flex-1 items-center gap-1 overflow-x-auto rounded-md border border-border bg-secondary/70 p-1">
          {TOOL_ITEMS.map((tool) => {
            const Icon = tool.icon;
            return (
              <Button
                key={tool.id}
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onToolChange(tool.id)}
                className="whitespace-nowrap"
                aria-label={tool.label}
                disabled={scrollCapturing}
              >
                <Icon className="size-4" aria-hidden="true" />
                {tool.label}
              </Button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onRunOcr}
            aria-label={t("app.action.ocr")}
            disabled={scrollCapturing}
          >
            <ScanText className="size-4" aria-hidden="true" />
            {t("app.action.ocr")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onStartScroll}
            aria-label={t("app.action.scroll")}
            disabled={scrollCapturing}
          >
            <ScrollText className="size-4" aria-hidden="true" />
            {t("app.action.scroll")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancel} aria-label={t("common.cancel")}>
            <X className="size-4" aria-hidden="true" />
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onFinish} aria-label={t("app.scroll.finish")}>
            <Check className="size-4" aria-hidden="true" />
            {t("app.scroll.finish")}
          </Button>
        </div>
      </div>
    </div>
  );
}
