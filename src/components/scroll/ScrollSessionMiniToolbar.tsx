import { Check, Download, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/useI18n";

type ScrollSessionMiniToolbarProps = {
  stitching: boolean;
  onCancel: () => void;
  onSave: () => void;
  onEdit: () => void;
  onCopyOnly: () => void;
};

export function ScrollSessionMiniToolbar({
  stitching,
  onCancel,
  onSave,
  onEdit,
  onCopyOnly,
}: ScrollSessionMiniToolbarProps) {
  const { t } = useI18n();

  return (
    <div className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-50 -translate-x-1/2 rounded-lg border border-border bg-card/95 p-1 shadow-sm">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label={t("app.scroll.action.cancel")}
          onClick={onCancel}
          disabled={stitching}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label={t("app.scroll.action.download")}
          onClick={onSave}
          disabled={stitching}
        >
          <Download className="size-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label={t("app.scroll.action.edit")}
          onClick={onEdit}
          disabled={stitching}
        >
          <Pencil className="size-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label={t("app.scroll.action.copyOnly")}
          onClick={onCopyOnly}
          disabled={stitching}
        >
          <Check className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
