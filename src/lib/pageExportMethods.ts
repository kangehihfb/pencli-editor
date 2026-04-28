import {
  canvasToBlob,
  createSerializablePageExportState,
  createUnscaledMeasuredClone,
  createCurrentPageExportResult,
  downloadBlob,
  loadImage,
  type PageExportResult,
  type PageExportSource,
} from './exportPageImage';
import domToImage from 'dom-to-image-more';
import html2canvas from 'html2canvas';
import { toPng } from 'html-to-image';
import { domToPng } from 'modern-screenshot';

export type PageExportMethodId =
  | 'current-foreign-object'
  | 'html-to-image'
  | 'modern-screenshot'
  | 'html2canvas'
  | 'dom-to-image-more'
  | 'playwright-screenshot';

export type PageExportAdapter = {
  id: PageExportMethodId;
  label: string;
  kind: 'client' | 'automation';
  export: (source: PageExportSource) => Promise<PageExportResult>;
};

export const currentPageExportAdapter: PageExportAdapter = {
  id: 'current-foreign-object',
  label: 'Current DOM clone + SVG foreignObject exporter',
  kind: 'client',
  export: createCurrentPageExportResult,
};

export const htmlToImagePageExportAdapter: PageExportAdapter = {
  id: 'html-to-image',
  label: 'html-to-image DOM exporter',
  kind: 'client',
  export: async ({ pageElement, webglCanvas, width, height }) => {
    const startedAt = performance.now();
    const measured = await createUnscaledMeasuredClone(pageElement, width, height);

    try {
      const pageDataUrl = await toPng(measured.measuredElement, {
        width,
        height,
        canvasWidth: width,
        canvasHeight: height,
        backgroundColor: '#ffffff',
        style: {
          width: `${width}px`,
          height: `${height}px`,
          zoom: '1',
          transform: 'none',
          transformOrigin: 'top left',
        },
      });

      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = width;
      exportCanvas.height = height;
      const context = exportCanvas.getContext('2d');
      if (!context) {
        throw new Error('Failed to create html-to-image export canvas context.');
      }

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);

      const pageImage = await loadImage(pageDataUrl);
      context.drawImage(pageImage, 0, 0, width, height);

      const webglImage = await loadImage(webglCanvas.toDataURL('image/png'));
      context.drawImage(webglImage, 0, 0, width, height);

      const blob = await canvasToBlob(exportCanvas);
      return {
        method: 'html-to-image',
        canvas: exportCanvas,
        blob,
        width,
        height,
        durationMs: performance.now() - startedAt,
      };
    } finally {
      measured.dispose();
    }
  },
};

export const modernScreenshotPageExportAdapter: PageExportAdapter = {
  id: 'modern-screenshot',
  label: 'modern-screenshot DOM exporter',
  kind: 'client',
  export: async ({ pageElement, webglCanvas, width, height }) => {
    const startedAt = performance.now();
    const measured = await createUnscaledMeasuredClone(pageElement, width, height);

    try {
      const pageDataUrl = await domToPng(measured.measuredElement, {
        width,
        height,
        scale: 1,
        backgroundColor: '#ffffff',
        style: {
          width: `${width}px`,
          height: `${height}px`,
          zoom: '1',
          transform: 'none',
          transformOrigin: 'top left',
        },
      });

      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = width;
      exportCanvas.height = height;
      const context = exportCanvas.getContext('2d');
      if (!context) {
        throw new Error('Failed to create modern-screenshot export canvas context.');
      }

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);

      const pageImage = await loadImage(pageDataUrl);
      context.drawImage(pageImage, 0, 0, width, height);

      const webglImage = await loadImage(webglCanvas.toDataURL('image/png'));
      context.drawImage(webglImage, 0, 0, width, height);

      const blob = await canvasToBlob(exportCanvas);
      return {
        method: 'modern-screenshot',
        canvas: exportCanvas,
        blob,
        width,
        height,
        durationMs: performance.now() - startedAt,
      };
    } finally {
      measured.dispose();
    }
  },
};

export const html2CanvasPageExportAdapter: PageExportAdapter = {
  id: 'html2canvas',
  label: 'html2canvas DOM renderer',
  kind: 'client',
  export: async ({ pageElement, webglCanvas, width, height }) => {
    const startedAt = performance.now();
    const measured = await createUnscaledMeasuredClone(pageElement, width, height);

    try {
      const pageCanvas = await html2canvas(measured.measuredElement, {
        backgroundColor: '#ffffff',
        width,
        height,
        scale: 1,
        windowWidth: width,
        windowHeight: height,
        useCORS: true,
      });

      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = width;
      exportCanvas.height = height;
      const context = exportCanvas.getContext('2d');
      if (!context) {
        throw new Error('Failed to create html2canvas export canvas context.');
      }

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(pageCanvas, 0, 0, width, height);

      const webglImage = await loadImage(webglCanvas.toDataURL('image/png'));
      context.drawImage(webglImage, 0, 0, width, height);

      const blob = await canvasToBlob(exportCanvas);
      return {
        method: 'html2canvas',
        canvas: exportCanvas,
        blob,
        width,
        height,
        durationMs: performance.now() - startedAt,
      };
    } finally {
      measured.dispose();
    }
  },
};

export const domToImageMorePageExportAdapter: PageExportAdapter = {
  id: 'dom-to-image-more',
  label: 'dom-to-image-more DOM exporter',
  kind: 'client',
  export: async ({ pageElement, webglCanvas, width, height }) => {
    const startedAt = performance.now();
    const measured = await createUnscaledMeasuredClone(pageElement, width, height);

    try {
      const pageDataUrl = await domToImage.toPng(measured.measuredElement, {
        width,
        height,
        bgcolor: '#ffffff',
        style: {
          width: `${width}px`,
          height: `${height}px`,
          zoom: '1',
          transform: 'none',
          transformOrigin: 'top left',
        },
      });

      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = width;
      exportCanvas.height = height;
      const context = exportCanvas.getContext('2d');
      if (!context) {
        throw new Error('Failed to create dom-to-image-more export canvas context.');
      }

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);

      const pageImage = await loadImage(pageDataUrl);
      context.drawImage(pageImage, 0, 0, width, height);

      const webglImage = await loadImage(webglCanvas.toDataURL('image/png'));
      context.drawImage(webglImage, 0, 0, width, height);

      const blob = await canvasToBlob(exportCanvas);
      return {
        method: 'dom-to-image-more',
        canvas: exportCanvas,
        blob,
        width,
        height,
        durationMs: performance.now() - startedAt,
      };
    } finally {
      measured.dispose();
    }
  },
};

export const playwrightScreenshotPageExportAdapter: PageExportAdapter = {
  id: 'playwright-screenshot',
  label: 'Playwright headless browser element screenshot',
  kind: 'automation',
  export: async ({ width, height, editorState }) => {
    const startedAt = performance.now();
    const serializableEditorState = editorState
      ? await createSerializablePageExportState(editorState)
      : undefined;
    const response = await fetch('/api/playwright-export', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        targetUrl: window.location.href,
        viewportWidth: 1600,
        viewportHeight: 1074,
        deviceScaleFactor: 1,
        editorState: serializableEditorState,
      }),
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? 'Playwright screenshot export failed.');
    }

    const image = await loadImage(`data:${payload.image.mimeType};base64,${payload.image.base64}`);
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    const context = exportCanvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to create Playwright screenshot export canvas context.');
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const blob = await canvasToBlob(exportCanvas);
    return {
      method: 'playwright-screenshot',
      canvas: exportCanvas,
      blob,
      width,
      height,
      durationMs: performance.now() - startedAt,
    };
  },
};

export const clientPageExportAdapters: PageExportAdapter[] = [
  currentPageExportAdapter,
  htmlToImagePageExportAdapter,
  modernScreenshotPageExportAdapter,
  html2CanvasPageExportAdapter,
  domToImageMorePageExportAdapter,
  playwrightScreenshotPageExportAdapter,
];

type CanvasDiffSummary = {
  comparedWith: PageExportMethodId;
  differentPixels: number;
  differentPixelRatio: number;
  meanChannelDelta: number;
  maxChannelDelta: number;
  thresholdDifferentPixels: number;
  thresholdDifferentPixelRatio: number;
};

function serializeRect(rect: DOMRect) {
  return {
    x: Number(rect.x.toFixed(2)),
    y: Number(rect.y.toFixed(2)),
    width: Number(rect.width.toFixed(2)),
    height: Number(rect.height.toFixed(2)),
    top: Number(rect.top.toFixed(2)),
    right: Number(rect.right.toFixed(2)),
    bottom: Number(rect.bottom.toFixed(2)),
    left: Number(rect.left.toFixed(2)),
  };
}

function collectExportEnvironment(source: PageExportSource) {
  const pageRect = source.pageElement.getBoundingClientRect();
  const canvasRect = source.webglCanvas.getBoundingClientRect();
  const frame = source.pageElement.closest('.stage-canvas-frame');
  const frameRect = frame?.getBoundingClientRect();
  const frameStyle = frame ? window.getComputedStyle(frame) : null;
  const viewport = window.visualViewport;

  return {
    generatedAt: new Date().toISOString(),
    browser: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
    },
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      availWidth: window.screen.availWidth,
      availHeight: window.screen.availHeight,
    },
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      visualViewport: viewport
        ? {
            width: Number(viewport.width.toFixed(2)),
            height: Number(viewport.height.toFixed(2)),
            scale: Number(viewport.scale.toFixed(4)),
            offsetLeft: Number(viewport.offsetLeft.toFixed(2)),
            offsetTop: Number(viewport.offsetTop.toFixed(2)),
          }
        : null,
    },
    scroll: {
      x: Number(window.scrollX.toFixed(2)),
      y: Number(window.scrollY.toFixed(2)),
    },
    page: {
      exportWidth: source.width,
      exportHeight: source.height,
      pageZoom: source.pageZoom ?? null,
      stagePageScale: source.stagePageScale ?? null,
      rect: serializeRect(pageRect),
      rectScaleX: Number((pageRect.width / source.width).toFixed(6)),
      rectScaleY: Number((pageRect.height / source.height).toFixed(6)),
    },
    canvas: {
      rect: serializeRect(canvasRect),
      bufferWidth: source.webglCanvas.width,
      bufferHeight: source.webglCanvas.height,
      bufferScaleX: Number((source.webglCanvas.width / Math.max(canvasRect.width, 1)).toFixed(6)),
      bufferScaleY: Number((source.webglCanvas.height / Math.max(canvasRect.height, 1)).toFixed(6)),
    },
    frame: frameRect
      ? {
          rect: serializeRect(frameRect),
          cssStagePageScale: frameStyle?.getPropertyValue('--stage-page-scale').trim() || null,
          cssStagePageWidth: frameStyle?.getPropertyValue('--stage-page-width').trim() || null,
          cssStagePageHeight: frameStyle?.getPropertyValue('--stage-page-height').trim() || null,
        }
      : null,
  };
}

function summarizeCanvasDiff(
  base: PageExportResult,
  target: PageExportResult,
  threshold = 4,
): CanvasDiffSummary | null {
  if (base.width !== target.width || base.height !== target.height) {
    return null;
  }

  const baseContext = base.canvas.getContext('2d');
  const targetContext = target.canvas.getContext('2d');
  if (!baseContext || !targetContext) {
    return null;
  }

  const width = base.width;
  const height = base.height;
  const basePixels = baseContext.getImageData(0, 0, width, height).data;
  const targetPixels = targetContext.getImageData(0, 0, width, height).data;
  const pixelCount = width * height;
  let differentPixels = 0;
  let thresholdDifferentPixels = 0;
  let totalChannelDelta = 0;
  let maxChannelDelta = 0;

  for (let index = 0; index < basePixels.length; index += 4) {
    const redDelta = Math.abs(basePixels[index] - targetPixels[index]);
    const greenDelta = Math.abs(basePixels[index + 1] - targetPixels[index + 1]);
    const blueDelta = Math.abs(basePixels[index + 2] - targetPixels[index + 2]);
    const alphaDelta = Math.abs(basePixels[index + 3] - targetPixels[index + 3]);
    const pixelMaxDelta = Math.max(redDelta, greenDelta, blueDelta, alphaDelta);

    if (pixelMaxDelta > 0) {
      differentPixels += 1;
    }
    if (pixelMaxDelta > threshold) {
      thresholdDifferentPixels += 1;
    }

    totalChannelDelta += redDelta + greenDelta + blueDelta + alphaDelta;
    maxChannelDelta = Math.max(maxChannelDelta, pixelMaxDelta);
  }

  return {
    comparedWith: base.method,
    differentPixels,
    differentPixelRatio: Number((differentPixels / pixelCount).toFixed(6)),
    meanChannelDelta: Number((totalChannelDelta / (pixelCount * 4)).toFixed(4)),
    maxChannelDelta,
    thresholdDifferentPixels,
    thresholdDifferentPixelRatio: Number((thresholdDifferentPixels / pixelCount).toFixed(6)),
  };
}

function downloadJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json',
  });
  downloadBlob(blob, filename);
}

export async function downloadClientPageExportComparison(
  source: PageExportSource,
  filenamePrefix = 'page-export-comparison',
) {
  const results: PageExportResult[] = [];
  const failures: Array<{
    method: PageExportMethodId;
    label: string;
    kind: PageExportAdapter['kind'];
    error: string;
  }> = [];

  for (const adapter of clientPageExportAdapters) {
    try {
      const result = await adapter.export(source);
      results.push(result);
      downloadBlob(result.blob, `${filenamePrefix}-${adapter.id}.png`);
    } catch (error) {
      failures.push({
        method: adapter.id,
        label: adapter.label,
        kind: adapter.kind,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const baseline = results[0];
  const summary = {
    environment: collectExportEnvironment(source),
    results: results.map((result) => ({
      method: result.method,
      width: result.width,
      height: result.height,
      blobSize: result.blob.size,
      durationMs: Number(result.durationMs.toFixed(1)),
      diffFromBaseline:
        result === baseline ? null : summarizeCanvasDiff(baseline, result),
    })),
    failures,
  };

  downloadJson(summary, `${filenamePrefix}-results.json`);

  console.table(summary.results);
  console.info('Export comparison environment', summary.environment);

  return results;
}
