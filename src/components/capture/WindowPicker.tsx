import { cn } from "@/lib/utils";
import type { CaptureRect, CaptureWindowInfo } from "@/ui-workflows/capture-shell/types";

type WindowPickerProps = {
  windows: CaptureWindowInfo[];
  hoveredWindowId: number | null;
  offsetX: number;
  offsetY: number;
  onSelect: (rect: CaptureRect) => void;
};

export function WindowPicker({ windows, hoveredWindowId, offsetX, offsetY, onSelect }: WindowPickerProps) {
  return (
    <>
      {windows.map((window) => {
        const isHovered = window.id === hoveredWindowId;
        return (
          <button
            key={window.id}
            type="button"
            aria-label={`Capture window ${window.appName} ${window.title}`}
            onClick={() =>
              onSelect({
                x: window.x,
                y: window.y,
                width: window.width,
                height: window.height,
              })
            }
            className={cn(
              "absolute border-2 transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isHovered ? "border-emerald-400 bg-emerald-400/10" : "border-transparent bg-transparent",
            )}
            style={{
              left: window.x - offsetX,
              top: window.y - offsetY,
              width: window.width,
              height: window.height,
            }}
          >
            {isHovered && (
              <span className="absolute left-2 top-2 rounded bg-black/80 px-2 py-1 text-xs text-white text-pretty">
                {window.appName}{window.title ? ` · ${window.title}` : ""}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}
