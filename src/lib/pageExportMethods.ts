import { domToPng } from "modern-screenshot";
import {
  canvasToBlob,
  createSerializablePageExportState,
  createUnscaledMeasuredClone,
  downloadBlob,
  loadImage,
  type PageExportResult,
  type PageExportSource,
} from "./exportPageImage";

export type PageExportMethodId = "modern-screenshot" | "playwright-screenshot";

export type PageExportAdapter = {
  id: PageExportMethodId;
  label: string;
  kind: "client" | "automation";
  export: (source: PageExportSource) => Promise<PageExportResult>;
};

export const modernScreenshotPageExportAdapter: PageExportAdapter = {
  id: "modern-screenshot",
  label: "modern-screenshot DOM exporter",
  kind: "client",
  export: async ({ pageElement, webglCanvas, width, height }) => {
    const startedAt = performance.now();
    const measured = await createUnscaledMeasuredClone(
      pageElement,
      width,
      height,
    );

    try {
      const pageDataUrl = await domToPng(measured.measuredElement, {
        width,
        height,
        scale: 1,
        backgroundColor: "#ffffff",
        style: {
          width: `${width}px`,
          height: `${height}px`,
          zoom: "1",
          transform: "none",
          transformOrigin: "top left",
        },
      });

      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = width;
      exportCanvas.height = height;
      const context = exportCanvas.getContext("2d");
      if (!context) {
        throw new Error(
          "Failed to create modern-screenshot export canvas context.",
        );
      }

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);

      const pageImage = await loadImage(pageDataUrl);
      context.drawImage(pageImage, 0, 0, width, height);

      const webglImage = await loadImage(webglCanvas.toDataURL("image/png"));
      context.drawImage(webglImage, 0, 0, width, height);

      const blob = await canvasToBlob(exportCanvas);
      return {
        method: "modern-screenshot",
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
  id: "playwright-screenshot",
  label: "Playwright headless browser element screenshot",
  kind: "automation",
  export: async ({ width, height, editorState }) => {
    const startedAt = performance.now();
    const serializableEditorState = editorState
      ? await createSerializablePageExportState(editorState)
      : undefined;
    const response = await fetch("/api/playwright-export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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
      throw new Error(payload.error ?? "Playwright screenshot export failed.");
    }

    const image = await loadImage(
      `data:${payload.image.mimeType};base64,${payload.image.base64}`,
    );
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = width;
    exportCanvas.height = height;
    const context = exportCanvas.getContext("2d");
    if (!context) {
      throw new Error(
        "Failed to create Playwright screenshot export canvas context.",
      );
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const blob = await canvasToBlob(exportCanvas);
    return {
      method: "playwright-screenshot",
      canvas: exportCanvas,
      blob,
      width,
      height,
      durationMs: performance.now() - startedAt,
    };
  },
};

export const pageExportAdapters: PageExportAdapter[] = [
  modernScreenshotPageExportAdapter,
  playwrightScreenshotPageExportAdapter,
];

export async function downloadClientPageExportComparison(
  source: PageExportSource,
  filenamePrefix = "page-export-comparison",
) {
  const results: PageExportResult[] = [];

  for (const adapter of pageExportAdapters) {
    const result = await adapter.export(source);
    results.push(result);
    downloadBlob(result.blob, `${filenamePrefix}-${adapter.id}.png`);
  }

  console.table(
    results.map((result) => ({
      method: result.method,
      width: result.width,
      height: result.height,
      blobSize: result.blob.size,
      durationMs: Number(result.durationMs.toFixed(1)),
    })),
  );

  return results;
}
