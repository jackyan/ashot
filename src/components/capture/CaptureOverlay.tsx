import { convertFileSrc } from "@tauri-apps/api/core";
import { useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { normalizeRect } from "@/ui-workflows/capture-shell/geometry";
import type {
  ActiveMonitorContext,
  CaptureRect,
  CaptureWindowInfo,
} from "@/ui-workflows/capture-shell/types";

type CaptureOverlayProps = {
  monitor: ActiveMonitorContext;
  windows: CaptureWindowInfo[];
  backgroundPath: string | null;
  selectedRect: CaptureRect | null;
  scrollCapturing: boolean;
  onSelect: (rect: CaptureRect, source: "window" | "region") => void;
};

const DRAG_THRESHOLD = 6;
const MIN_SELECTION_SIZE = 12;

export function CaptureOverlay({
  monitor,
  windows,
  backgroundPath,
  selectedRect,
  scrollCapturing,
  onSelect,
}: CaptureOverlayProps) {
  const [selection, setSelection] = useState<CaptureRect | null>(null);
  const [hoveredWindowId, setHoveredWindowId] = useState<number | null>(null);

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const findWindowAt = (globalX: number, globalY: number) => {
    return windows.find(
      (window) =>
        globalX >= window.x &&
        globalX <= window.x + window.width &&
        globalY >= window.y &&
        globalY <= window.y + window.height,
    );
  };

  const toLocalPoint = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    return { x, y };
  };

  const toGlobalRect = (localRect: CaptureRect): CaptureRect => ({
    x: localRect.x + monitor.x,
    y: localRect.y + monitor.y,
    width: localRect.width,
    height: localRect.height,
  });

  const selectedLocalRect = useMemo(() => {
    if (!selectedRect) return null;
    return {
      x: selectedRect.x - monitor.x,
      y: selectedRect.y - monitor.y,
      width: selectedRect.width,
      height: selectedRect.height,
    };
  }, [monitor.x, monitor.y, selectedRect]);

  const hoveredWindow = useMemo(
    () => windows.find((window) => window.id === hoveredWindowId) ?? null,
    [hoveredWindowId, windows],
  );

  const resetPointerTracking = () => {
    dragStartRef.current = null;
    isDraggingRef.current = false;
    setSelection(null);
  };

  const handlePointerDown = (event: MouseEvent<HTMLDivElement>) => {
    if (scrollCapturing) return;
    dragStartRef.current = toLocalPoint(event);
    isDraggingRef.current = false;
    setSelection(null);
  };

  const handlePointerLeave = () => {
    if (!isDraggingRef.current) {
      setHoveredWindowId(null);
    }
    resetPointerTracking();
  };

  const beginDraggingIfNeeded = (
    startX: number,
    startY: number,
    currentX: number,
    currentY: number,
  ) => {
    if (isDraggingRef.current) return;
    const dx = currentX - startX;
    const dy = currentY - startY;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    isDraggingRef.current = true;
    setSelection(normalizeRect(startX, startY, currentX, currentY));
  };

  const handlePointerMove = (event: MouseEvent<HTMLDivElement>) => {
    if (scrollCapturing) return;
    const point = toLocalPoint(event);
    const globalX = point.x + monitor.x;
    const globalY = point.y + monitor.y;
    const matchedWindow = findWindowAt(globalX, globalY);
    setHoveredWindowId(matchedWindow?.id ?? null);

    const dragStart = dragStartRef.current;
    if (!dragStart) return;

    beginDraggingIfNeeded(dragStart.x, dragStart.y, point.x, point.y);
    if (!isDraggingRef.current) return;
    setSelection(normalizeRect(dragStart.x, dragStart.y, point.x, point.y));
  };

  const handlePointerUp = (event: MouseEvent<HTMLDivElement>) => {
    if (scrollCapturing) return;
    const point = toLocalPoint(event);
    const globalX = point.x + monitor.x;
    const globalY = point.y + monitor.y;

    if (isDraggingRef.current && selection) {
      const isSmallSelection =
        selection.width < MIN_SELECTION_SIZE || selection.height < MIN_SELECTION_SIZE;
      if (!isSmallSelection) {
        onSelect(toGlobalRect(selection), "region");
      }
      resetPointerTracking();
      return;
    }

    const target = findWindowAt(globalX, globalY) ?? hoveredWindow;
    if (!target) return;
    onSelect(
      {
        x: target.x,
        y: target.y,
        width: target.width,
        height: target.height,
      },
      "window",
    );
    resetPointerTracking();
  };

  const hoveredLocalRect = hoveredWindow
    ? {
        x: hoveredWindow.x - monitor.x,
        y: hoveredWindow.y - monitor.y,
        width: hoveredWindow.width,
        height: hoveredWindow.height,
      }
    : null;

  const liveRect = selection ?? hoveredLocalRect;
  const hasLiveRect = Boolean(liveRect);

  return (
    <div
      className="fixed z-50 select-none"
      style={{
        left: monitor.x,
        top: monitor.y,
        width: monitor.width,
        height: monitor.height,
      }}
      onMouseDown={handlePointerDown}
      onMouseMove={handlePointerMove}
      onMouseUp={handlePointerUp}
      onMouseLeave={handlePointerLeave}
      role="presentation"
    >
      {backgroundPath ? (
        <img
          src={convertFileSrc(backgroundPath)}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 size-full object-fill"
          draggable={false}
        />
      ) : null}

      {!scrollCapturing && (
        <div
          className="absolute inset-0 bg-black/30"
          style={
            hasLiveRect
              ? undefined
              : {
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
                }
          }
        />
      )}

      {!scrollCapturing && liveRect && (
        <div
          className="absolute border-2 border-emerald-400 bg-transparent"
          style={{
            left: liveRect.x,
            top: liveRect.y,
            width: liveRect.width,
            height: liveRect.height,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.30)",
          }}
        >
          <div className="absolute -top-7 left-0 rounded bg-black/80 px-2 py-1 text-xs text-white tabular-nums">
            {Math.round(liveRect.width)} × {Math.round(liveRect.height)}
          </div>
        </div>
      )}

      {selectedLocalRect && (
        <div
          className={cn(
            "pointer-events-none absolute border-2",
            scrollCapturing ? "border-emerald-400" : "border-emerald-400/90",
          )}
          style={{
            left: selectedLocalRect.x,
            top: selectedLocalRect.y,
            width: selectedLocalRect.width,
            height: selectedLocalRect.height,
          }}
        >
          <div className="absolute -top-7 left-0 rounded bg-black/80 px-2 py-1 text-xs text-white tabular-nums">
            {Math.round(selectedLocalRect.width)} × {Math.round(selectedLocalRect.height)}
          </div>
        </div>
      )}
    </div>
  );
}
