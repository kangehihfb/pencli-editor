type ExportPageImageOptions = {
  pageElement: HTMLElement;
  webglCanvas: HTMLCanvasElement;
  width: number;
  height: number;
  filename?: string;
};

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load export image source.'));
    image.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to create export image blob.'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

function copyInputState(source: HTMLElement, clone: HTMLElement) {
  if (source instanceof HTMLInputElement && clone instanceof HTMLInputElement) {
    clone.value = source.value;
    if (source.checked) clone.setAttribute('checked', '');
  }

  if (source instanceof HTMLTextAreaElement && clone instanceof HTMLTextAreaElement) {
    clone.value = source.value;
    clone.textContent = source.value;
  }
}

function inlineComputedStyles(source: HTMLElement, clone: HTMLElement) {
  const computed = window.getComputedStyle(source);
  for (const property of computed) {
    clone.style.setProperty(
      property,
      computed.getPropertyValue(property),
      computed.getPropertyPriority(property),
    );
  }

  copyInputState(source, clone);

  const sourceChildren = Array.from(source.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  const cloneChildren = Array.from(clone.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );

  sourceChildren.forEach((child, index) => {
    const cloneChild = cloneChildren[index];
    if (!cloneChild) return;
    inlineComputedStyles(child, cloneChild);
  });
}

async function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read image blob.'));
    reader.readAsDataURL(blob);
  });
}

async function inlineImages(clone: HTMLElement) {
  const images = Array.from(clone.querySelectorAll('img'));

  await Promise.all(
    images.map(async (image) => {
      const src = image.getAttribute('src');
      if (!src || src.startsWith('data:')) return;

      try {
        const response = await fetch(src);
        const blob = await response.blob();
        image.setAttribute('src', await blobToDataUrl(blob));
      } catch {
        // Keep the original src if the browser cannot inline it.
      }
    }),
  );
}

async function renderElementToImage(
  element: HTMLElement,
  width: number,
  height: number,
) {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  inlineComputedStyles(element, clone);
  await inlineImages(clone);

  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.transform = 'none';
  clone.style.transformOrigin = 'top left';

  const markup = new XMLSerializer().serializeToString(clone);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<foreignObject x="0" y="0" width="${width}" height="${height}">`,
    markup,
    '</foreignObject>',
    '</svg>',
  ].join('');

  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportPageImage({
  pageElement,
  webglCanvas,
  width,
  height,
  filename = 'exam-with-handwriting.png',
}: ExportPageImageOptions) {
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = width;
  exportCanvas.height = height;
  const context = exportCanvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to create export canvas context.');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);

  const pageImage = await renderElementToImage(pageElement, width, height);
  context.drawImage(pageImage, 0, 0, width, height);

  const webglImage = await loadImage(webglCanvas.toDataURL('image/png'));
  context.drawImage(webglImage, 0, 0, width, height);

  const blob = await canvasToBlob(exportCanvas);
  downloadBlob(blob, filename);
  console.info(`Exported ${filename} (${width}x${height})`);
}
