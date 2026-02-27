import { convertFileSrc } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import { createHighQualityCanvas } from "./canvas-utils";
import { resolveBackgroundPath, getDefaultBackgroundPath } from "./asset-registry";

type BackgroundType = "transparent" | "white" | "black" | "gray" | "custom" | "image" | "gradient";

const IMAGE_LOAD_TIMEOUT_MS = 5000;
const CANVAS_EXPORT_TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function loadImage(src: string, context: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${context}: ${src}`));
    img.src = src;
  });
}

function canvasToDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to create blob from canvas"));
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve(reader.result as string);
        };
        reader.onerror = () => {
          reject(new Error("Failed to read processed image"));
        };
        reader.readAsDataURL(blob);
      },
      "image/png",
      1.0,
    );
  });
}

export async function processScreenshotWithDefaultBackground(
  imagePath: string,
): Promise<string> {
  let backgroundType: BackgroundType = "image";
  let customColor = "#667eea";
  let defaultBgImage = getDefaultBackgroundPath();

  try {
    const store = await Store.load("settings.json");
    const storedBgType = await store.get<BackgroundType>("defaultBackgroundType");
    const storedCustomColor = await store.get<string>("defaultCustomColor");
    const storedDefaultBg = await store.get<string>("defaultBackgroundImage");

    if (storedBgType) {
      backgroundType = storedBgType;
    }
    if (storedCustomColor) {
      customColor = storedCustomColor;
    }
    if (storedDefaultBg && (backgroundType === "image" || backgroundType === "gradient")) {
      defaultBgImage = resolveBackgroundPath(storedDefaultBg);
    }
  } catch (error) {
    console.error("Failed to load default background from settings:", error);
  }

  const assetUrl = convertFileSrc(imagePath);
  const image = await withTimeout(
    loadImage(assetUrl, "screenshot image"),
    IMAGE_LOAD_TIMEOUT_MS,
    `Timed out loading screenshot image: ${imagePath}`,
  );

  const avgDimension = (image.width + image.height) / 2;
  const basePadding = Math.min(Math.round(avgDimension * 0.1), 400);
  const isTransparent = backgroundType === "transparent";
  const finalPadding = isTransparent ? 0 : basePadding;

  let backgroundImage: HTMLImageElement | null = null;
  if (backgroundType === "image" || backgroundType === "gradient") {
    backgroundImage = await withTimeout(
      loadImage(defaultBgImage, "background image"),
      IMAGE_LOAD_TIMEOUT_MS,
      `Timed out loading background image: ${defaultBgImage}`,
    );
  }

  const isGradient = backgroundType === "gradient";
  const canvas = createHighQualityCanvas({
    image,
    backgroundType,
    customColor,
    selectedImage: isGradient ? null : defaultBgImage,
    bgImage: isGradient ? null : backgroundImage,
    gradientImage: isGradient ? backgroundImage : null,
    blurAmount: 0,
    noiseAmount: 20,
    borderRadius: 12,
    paddingTop: finalPadding,
    paddingBottom: finalPadding,
    paddingLeft: finalPadding,
    paddingRight: finalPadding,
    shadow: isTransparent
      ? {
          blur: 0,
          offsetX: 0,
          offsetY: 0,
          opacity: 0,
        }
      : {
          blur: 33,
          offsetX: 18,
          offsetY: 23,
          opacity: 39,
        },
  });

  return withTimeout(
    canvasToDataUrl(canvas),
    CANVAS_EXPORT_TIMEOUT_MS,
    "Timed out exporting processed screenshot",
  );
}
