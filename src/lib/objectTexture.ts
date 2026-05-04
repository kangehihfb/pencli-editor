import * as THREE from "three";
import {
  DEFAULT_TEXT_FONT_FAMILY,
  getEditorTextCanvasFont,
} from "./editorTextFonts";

export const DEFAULT_TEXT_FONT_SIZE = 32;
export const MIN_TEXT_FONT_SIZE = 7;
export const MAX_TEXT_FONT_SIZE = 180;
export const DEFAULT_TEXT_COLOR = "#1f2a44";

const textLineHeightRatio = 1.22;

function configureTexture(texture: THREE.Texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 4;
  return texture;
}

function getTextLines(text: string) {
  const lines = text.split(/\r?\n/);
  return lines.length > 0 ? lines : [""];
}

export function clampTextFontSize(fontSize: number) {
  return THREE.MathUtils.clamp(
    fontSize,
    MIN_TEXT_FONT_SIZE,
    MAX_TEXT_FONT_SIZE,
  );
}

export function measureTextObject(
  text: string,
  fontSize = DEFAULT_TEXT_FONT_SIZE,
  fontFamily = DEFAULT_TEXT_FONT_FAMILY,
) {
  const safeFontSize = clampTextFontSize(fontSize);
  const lines = getTextLines(text || " ");
  const lineHeight = safeFontSize * textLineHeightRatio;
  const paddingX = Math.max(8, safeFontSize * 0.28);
  const paddingY = Math.max(4, safeFontSize * 0.14);

  if (typeof document === "undefined") {
    const maxLength = Math.max(1, ...lines.map((line) => line.length));
    return {
      width: Math.max(14, maxLength * safeFontSize * 0.62 + paddingX * 2),
      height: Math.max(lineHeight, lines.length * lineHeight + paddingY * 2),
    };
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    return {
      width: Math.max(14, safeFontSize + paddingX * 2),
      height: Math.max(lineHeight, lines.length * lineHeight + paddingY * 2),
    };
  }

  context.font = getEditorTextCanvasFont(safeFontSize, fontFamily);
  const textWidth = Math.max(
    0,
    ...lines.map((line) => context.measureText(line || " ").width),
  );
  return {
    width: Math.max(14, Math.ceil(textWidth + paddingX * 2)),
    height: Math.max(
      lineHeight,
      Math.ceil(lines.length * lineHeight + paddingY * 2),
    ),
  };
}

type ImageTextureOptions = {
  imageSrc?: string;
  backgroundColor?: string;
};

function createPlaceholderTexture(backgroundColor = "#ffffff") {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  return configureTexture(new THREE.CanvasTexture(canvas));
}

export function createImageObjectTexture({
  imageSrc,
  backgroundColor,
}: ImageTextureOptions) {
  if (imageSrc) {
    if (!backgroundColor) {
      const texture = configureTexture(new THREE.Texture());
      const image = new Image();
      image.decoding = "async";
      if (/^https?:/i.test(imageSrc)) {
        image.crossOrigin = "anonymous";
      }

      image.addEventListener("load", () => {
        texture.image = image;
        texture.needsUpdate = true;
      });

      image.src = imageSrc;
      return texture;
    }

    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const texture = createPlaceholderTexture(backgroundColor);
    const image = new Image();
    image.decoding = "async";
    if (/^https?:/i.test(imageSrc)) {
      image.crossOrigin = "anonymous";
    }

    image.addEventListener("load", () => {
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const imageContext = canvas.getContext("2d");
      if (!imageContext) return;

      imageContext.fillStyle = backgroundColor;
      imageContext.fillRect(0, 0, canvas.width, canvas.height);
      imageContext.drawImage(image, 0, 0, canvas.width, canvas.height);
      texture.image = canvas;
      texture.needsUpdate = true;
    });

    image.src = imageSrc;
    return texture;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 420;
  const context = canvas.getContext("2d");

  if (context) {
    const gradient = context.createLinearGradient(
      0,
      0,
      canvas.width,
      canvas.height,
    );
    gradient.addColorStop(0, "#cbd7ff");
    gradient.addColorStop(1, "#c9f3e9");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(255, 255, 255, 0.36)";
    for (let x = -canvas.height; x < canvas.width; x += 64) {
      context.fillRect(x, 0, 24, canvas.height);
    }
    context.fillStyle = "#17324d";
    context.font =
      "800 58px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("Image", canvas.width / 2, canvas.height / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  return configureTexture(texture);
}
