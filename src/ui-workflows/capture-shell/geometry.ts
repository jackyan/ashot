import type {
  ActiveMonitorContext,
  CaptureRect,
  MonitorBounds,
  MonitorShot,
  ScrollPreviewPlacement,
} from "./types";

export function normalizeRect(startX: number, startY: number, endX: number, endY: number): CaptureRect {
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);
  return { x, y, width, height };
}

export function getMonitorBounds(shots: MonitorShot[]): MonitorBounds {
  const minX = Math.min(...shots.map((shot) => shot.x));
  const minY = Math.min(...shots.map((shot) => shot.y));
  const maxX = Math.max(...shots.map((shot) => shot.x + shot.width));
  const maxY = Math.max(...shots.map((shot) => shot.y + shot.height));
  return {
    minX,
    minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function pointInRect(x: number, y: number, rect: CaptureRect): boolean {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}

export function findMonitorForRect(rect: CaptureRect, shots: MonitorShot[]): MonitorShot | null {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  return (
    shots.find((shot) =>
      pointInRect(centerX, centerY, {
        x: shot.x,
        y: shot.y,
        width: shot.width,
        height: shot.height,
      }),
    ) ?? null
  );
}

export function findMonitorForPoint(x: number, y: number, shots: MonitorShot[]): MonitorShot | null {
  return (
    shots.find((shot) =>
      pointInRect(x, y, {
        x: shot.x,
        y: shot.y,
        width: shot.width,
        height: shot.height,
      }),
    ) ?? null
  );
}

export function clampRectToMonitor(rect: CaptureRect, monitor: ActiveMonitorContext): CaptureRect {
  const x = Math.max(monitor.x, Math.min(rect.x, monitor.x + monitor.width - 1));
  const y = Math.max(monitor.y, Math.min(rect.y, monitor.y + monitor.height - 1));
  const maxWidth = monitor.x + monitor.width - x;
  const maxHeight = monitor.y + monitor.height - y;

  return {
    x,
    y,
    width: Math.max(1, Math.min(rect.width, maxWidth)),
    height: Math.max(1, Math.min(rect.height, maxHeight)),
  };
}

export function getFullscreenRectForMonitor(monitor: ActiveMonitorContext): CaptureRect {
  return {
    x: monitor.x,
    y: monitor.y,
    width: monitor.width,
    height: monitor.height,
  };
}

export function getScrollPreviewPlacement(
  monitor: ActiveMonitorContext,
  rect: CaptureRect,
  panelWidth: number,
  gap: number,
): ScrollPreviewPlacement {
  const rightSpace = monitor.x + monitor.width - (rect.x + rect.width);
  if (rightSpace >= panelWidth + gap) {
    return "right";
  }
  return "left";
}
