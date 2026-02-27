export type CaptureErrorKind =
  | "cancelled"
  | "permission"
  | "io"
  | "timeout"
  | "processing"
  | "ocr_empty";

export function classifyCaptureError(message: string): CaptureErrorKind {
  const lower = message.toLowerCase();
  if (lower.includes("cancelled") || lower.includes("was cancelled")) return "cancelled";
  if (
    lower.includes("permission") ||
    lower.includes("access") ||
    lower.includes("denied") ||
    lower.includes("not authorized") ||
    lower.includes("could not create image from display")
  ) return "permission";
  if (lower.includes("timed out") || lower.includes("timeout")) return "timeout";
  if (lower.includes("no text recognized")) return "ocr_empty";
  if (
    lower.includes("failed to process screenshot") ||
    lower.includes("failed to load background image") ||
    lower.includes("failed to read processed image") ||
    lower.includes("failed to create blob")
  ) return "processing";
  return "io";
}
