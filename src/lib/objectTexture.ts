import * as THREE from 'three';

export const DEFAULT_TEXT_FONT_SIZE = 32;
export const MIN_TEXT_FONT_SIZE = 10;
export const MAX_TEXT_FONT_SIZE = 180;
export const DEFAULT_TEXT_COLOR = '#1f2a44';

const textFontWeight = 700;
const textFontFamily = '"Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
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

type TextTextureOptions = {
  text: string;
  width: number;
  height: number;
  fontSize?: number;
  color?: string;
};

function getTextLines(text: string) {
  const lines = text.split(/\r?\n/);
  return lines.length > 0 ? lines : [''];
}

function getTextFont(fontSize: number) {
  return `${textFontWeight} ${fontSize}px ${textFontFamily}`;
}

function getTextTextureScale(fontSize: number) {
  return Math.max(4, Math.min(10, Math.ceil(96 / Math.max(fontSize, 1))));
}

export function clampTextFontSize(fontSize: number) {
  return THREE.MathUtils.clamp(fontSize, MIN_TEXT_FONT_SIZE, MAX_TEXT_FONT_SIZE);
}

export function measureTextObject(text: string, fontSize = DEFAULT_TEXT_FONT_SIZE) {
  const safeFontSize = clampTextFontSize(fontSize);
  const lines = getTextLines(text || ' ');
  const lineHeight = safeFontSize * textLineHeightRatio;
  const paddingX = Math.max(8, safeFontSize * 0.28);
  const paddingY = Math.max(4, safeFontSize * 0.14);

  if (typeof document === 'undefined') {
    const maxLength = Math.max(1, ...lines.map((line) => line.length));
    return {
      width: Math.max(14, maxLength * safeFontSize * 0.62 + paddingX * 2),
      height: Math.max(lineHeight, lines.length * lineHeight + paddingY * 2),
    };
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      width: Math.max(14, safeFontSize + paddingX * 2),
      height: Math.max(lineHeight, lines.length * lineHeight + paddingY * 2),
    };
  }

  ctx.font = getTextFont(safeFontSize);
  const textWidth = Math.max(0, ...lines.map((line) => ctx.measureText(line || ' ').width));
  return {
    width: Math.max(14, Math.ceil(textWidth + paddingX * 2)),
    height: Math.max(lineHeight, Math.ceil(lines.length * lineHeight + paddingY * 2)),
  };
}

export function createTextObjectTexture({ text, width, height, fontSize = DEFAULT_TEXT_FONT_SIZE, color = DEFAULT_TEXT_COLOR }: TextTextureOptions) {
  const safeFontSize = clampTextFontSize(fontSize);
  const textureScale = getTextTextureScale(safeFontSize);
  const lines = getTextLines(text || ' ');
  const lineHeight = safeFontSize * textLineHeightRatio;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(16, Math.ceil(width * textureScale));
  canvas.height = Math.max(16, Math.ceil(height * textureScale));
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.scale(textureScale, textureScale);
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = color;
    ctx.font = getTextFont(safeFontSize);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const blockHeight = lines.length * lineHeight;
    const startY = height / 2 - blockHeight / 2 + lineHeight / 2;
    lines.forEach((line, index) => {
      ctx.fillText(line || ' ', width / 2, startY + index * lineHeight);
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  configureTexture(texture);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

type ImageTextureOptions = {
  imageSrc?: string;
  backgroundColor?: string;
};

function createPlaceholderTexture(backgroundColor = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  return configureTexture(new THREE.CanvasTexture(canvas));
}

export function createImageObjectTexture({ imageSrc, backgroundColor }: ImageTextureOptions) {
  if (imageSrc) {
    if (!backgroundColor) {
      const texture = configureTexture(new THREE.Texture());
      const image = new Image();
      image.decoding = 'async';
      if (/^https?:/i.test(imageSrc)) {
        image.crossOrigin = 'anonymous';
      }

      image.onload = () => {
        texture.image = image;
        texture.needsUpdate = true;
      };

      image.src = imageSrc;
      return texture;
    }

    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const texture = createPlaceholderTexture(backgroundColor);
    const image = new Image();
    image.decoding = 'async';
    if (/^https?:/i.test(imageSrc)) {
      image.crossOrigin = 'anonymous';
    }

    image.onload = () => {
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const imageCtx = canvas.getContext('2d');
      if (!imageCtx) return;

      imageCtx.fillStyle = backgroundColor;
      imageCtx.fillRect(0, 0, canvas.width, canvas.height);
      imageCtx.drawImage(image, 0, 0, canvas.width, canvas.height);
      texture.image = canvas;
      texture.needsUpdate = true;
    };

    image.src = imageSrc;
    return texture;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 420;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#cbd7ff');
    gradient.addColorStop(1, '#c9f3e9');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.36)';
    for (let x = -canvas.height; x < canvas.width; x += 64) {
      ctx.fillRect(x, 0, 24, canvas.height);
    }
    ctx.fillStyle = '#17324d';
    ctx.font = '800 58px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Image', canvas.width / 2, canvas.height / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  return configureTexture(texture);
}
