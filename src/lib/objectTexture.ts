import * as THREE from 'three';

function configureTexture(texture: THREE.Texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  return texture;
}

export function createTextObjectTexture(text: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 220;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1f2a44';
    ctx.font = '700 58px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text || ' ', canvas.width / 2, canvas.height / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  return configureTexture(texture);
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
