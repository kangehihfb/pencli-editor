import type { Stroke, WebGLObject } from "../types/editor";

export type PageExportState = {
  strokes: Stroke[];
  objects: WebGLObject[];
};

export type PageExportSource = {
  pageElement: HTMLElement;
  webglCanvas: HTMLCanvasElement;
  width: number;
  height: number;
  pageZoom?: number;
  stagePageScale?: number;
  editorState?: PageExportState;
};

export type ExportPageImageOptions = PageExportSource & {
  filename?: string;
};

export type PageExportMethod =
  | "current-foreign-object"
  | "modern-screenshot"
  | "playwright-screenshot";

export type PageExportResult = {
  method: PageExportMethod;
  canvas: HTMLCanvasElement;
  blob: Blob;
  width: number;
  height: number;
  durationMs: number;
};

export function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.onerror = () =>
      reject(new Error("Failed to load export image source."));
    image.src = source;
  });
}

export function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to create export image blob."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function copyInputState(source: HTMLElement, clone: HTMLElement) {
  if (source instanceof HTMLInputElement && clone instanceof HTMLInputElement) {
    clone.value = source.value;
    if (source.checked) clone.setAttribute("checked", "");
  }

  if (
    source instanceof HTMLTextAreaElement &&
    clone instanceof HTMLTextAreaElement
  ) {
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

  const sourceChildren = [...source.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  const cloneChildren = [...clone.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );

  for (const [index, child] of sourceChildren.entries()) {
    const cloneChild = cloneChildren[index];
    if (!cloneChild) continue;
    inlineComputedStyles(child, cloneChild);
  }
}

export async function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.onerror = () => reject(new Error("Failed to read image blob."));
    reader.readAsDataURL(blob);
  });
}

async function resolveExportImageSource(imageSource?: string) {
  if (!imageSource || imageSource.startsWith("data:")) {
    return imageSource;
  }

  if (!imageSource.startsWith("blob:")) {
    return imageSource;
  }

  const response = await fetch(imageSource);
  const blob = await response.blob();
  return blobToDataUrl(blob);
}

export async function createSerializablePageExportState(
  state: PageExportState,
): Promise<PageExportState> {
  return {
    strokes: state.strokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({ ...point })),
    })),
    objects: await Promise.all(
      state.objects.map(async (object) => ({
        ...object,
        imageSrc: await resolveExportImageSource(object.imageSrc),
      })),
    ),
  };
}

async function inlineImages(clone: HTMLElement) {
  const images = [...clone.querySelectorAll("img")];

  await Promise.all(
    images.map(async (image) => {
      const source = image.getAttribute("src");
      if (!source || source.startsWith("data:")) return;

      try {
        const response = await fetch(source);
        const blob = await response.blob();
        image.setAttribute("src", await blobToDataUrl(blob));
      } catch {
        // Keep the original src if the browser cannot inline it.
      }
    }),
  );
}

function waitForFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export async function createUnscaledMeasuredClone(
  element: HTMLElement,
  width: number,
  height: number,
) {
  const measurementFrame = document.createElement("div");
  measurementFrame.className = "stage-canvas-frame is-fixed-page";
  measurementFrame.style.position = "fixed";
  measurementFrame.style.left = "-100000px";
  measurementFrame.style.right = "auto";
  measurementFrame.style.top = "0";
  measurementFrame.style.bottom = "auto";
  measurementFrame.style.width = `${width}px`;
  measurementFrame.style.height = `${height}px`;
  measurementFrame.style.overflow = "hidden";
  measurementFrame.style.pointerEvents = "none";
  measurementFrame.style.setProperty("--exam-aspect", String(width / height));
  measurementFrame.style.setProperty("--stage-page-width", `${width}px`);
  measurementFrame.style.setProperty("--stage-page-height", `${height}px`);
  measurementFrame.style.setProperty("--stage-page-scale", "1");

  const measurementShell = document.createElement("div");
  measurementShell.className = "stage-page-scale-box";
  const measurementCanvasShell = document.createElement("div");
  measurementCanvasShell.className = "stage-canvas-shell";
  const measurementLayer = document.createElement("div");
  measurementLayer.className = "stage-react-exam-layer";
  const measurementPage = element.cloneNode(true) as HTMLElement;

  measurementLayer.append(measurementPage);
  measurementCanvasShell.append(measurementLayer);
  measurementShell.append(measurementCanvasShell);
  measurementFrame.append(measurementShell);
  document.body.append(measurementFrame);

  await waitForFrame();

  return {
    measuredElement: measurementPage,
    dispose: () => measurementFrame.remove(),
  };
}

export async function renderElementToImage(
  element: HTMLElement,
  width: number,
  height: number,
) {
  const measured = await createUnscaledMeasuredClone(element, width, height);

  try {
    const clone = measured.measuredElement.cloneNode(true) as HTMLElement;
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    inlineComputedStyles(measured.measuredElement, clone);
    await inlineImages(clone);

    clone.style.width = `${width}px`;
    clone.style.height = `${height}px`;
    clone.style.setProperty("zoom", "1");
    clone.style.transform = "none";
    clone.style.transformOrigin = "top left";

    const markup = new XMLSerializer().serializeToString(clone);
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<foreignObject x="0" y="0" width="${width}" height="${height}">`,
      markup,
      "</foreignObject>",
      "</svg>",
    ].join("");

    return loadImage(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    );
  } finally {
    measured.dispose();
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function createCurrentPageExportCanvas({
  pageElement,
  webglCanvas,
  width,
  height,
}: PageExportSource) {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = width;
  exportCanvas.height = height;
  const context = exportCanvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to create export canvas context.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  const pageImage = await renderElementToImage(pageElement, width, height);
  context.drawImage(pageImage, 0, 0, width, height);

  const webglImage = await loadImage(webglCanvas.toDataURL("image/png"));
  context.drawImage(webglImage, 0, 0, width, height);

  return exportCanvas;
}

export async function createCurrentPageExportBlob(options: PageExportSource) {
  const canvas = await createCurrentPageExportCanvas(options);
  return canvasToBlob(canvas);
}

export async function createCurrentPageExportResult(
  options: PageExportSource,
): Promise<PageExportResult> {
  const startedAt = performance.now();
  const canvas = await createCurrentPageExportCanvas(options);
  const blob = await canvasToBlob(canvas);

  return {
    method: "current-foreign-object",
    canvas,
    blob,
    width: options.width,
    height: options.height,
    durationMs: performance.now() - startedAt,
  };
}

export async function exportPageImage({
  filename = "exam-with-handwriting.png",
  ...source
}: ExportPageImageOptions) {
  const result = await createCurrentPageExportResult(source);
  downloadBlob(result.blob, filename);
  console.info(
    `Exported ${filename} (${result.width}x${result.height}) in ${result.durationMs.toFixed(1)}ms`,
  );
  return result;
}
