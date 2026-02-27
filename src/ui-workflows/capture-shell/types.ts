export type OverlayCaptureMode = "region" | "window" | "fullscreen" | "scroll";

export type CaptureRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MonitorShot = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  scale_factor: number;
  path: string;
};

export type CaptureWindowInfo = {
  id: number;
  appName: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
};

export type MonitorBounds = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

export type ActiveMonitorContext = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
  label: string;
};

export type ScrollPreviewPlacement = "right" | "left";
