import { recordSpanError, startFrontendSpan } from "./observability";

export type OptimizedUploadImage = {
  file: File;
  originalFile: File;
  originalSizeBytes: number;
  uploadSizeBytes: number;
  width?: number;
  height?: number;
  optimized: boolean;
};

type OptimizeImageForUploadOptions = {
  maxLongEdge?: number;
  quality?: number;
  mimeType?: string;
};

const defaultMaxLongEdge = 1600;
const defaultQuality = 0.72;
const defaultMimeType = "image/webp";
const optimizableMimeTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

function canOptimizeImage(file: File): boolean {
  return optimizableMimeTypes.has(file.type.toLowerCase());
}

function getOptimizedFileName(fileName: string, mimeType: string): string {
  const extension = mimeType === "image/webp" ? "webp" : "jpg";
  const baseName = fileName.replace(/\.[^.]+$/, "") || "image";
  return `${baseName}.${extension}`;
}

function getScaledSize(input: {
  width: number;
  height: number;
  maxLongEdge: number;
}): { width: number; height: number } {
  const longEdge = Math.max(input.width, input.height);
  if (longEdge <= 0) return { width: input.width, height: input.height };

  const scale = Math.min(1, input.maxLongEdge / longEdge);
  return {
    width: Math.max(1, Math.round(input.width * scale)),
    height: Math.max(1, Math.round(input.height * scale)),
  };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob | undefined> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? undefined), mimeType, quality);
  });
}

function getOriginalUploadImage(file: File): OptimizedUploadImage {
  return {
    file,
    originalFile: file,
    originalSizeBytes: file.size,
    uploadSizeBytes: file.size,
    optimized: false,
  };
}

function setResultAttributes(
  span: ReturnType<typeof startFrontendSpan>,
  result: OptimizedUploadImage,
): void {
  span.setAttributes({
    "image.optimize.optimized": result.optimized,
    "image.optimize.original_size_bytes": result.originalSizeBytes,
    "image.optimize.output_size_bytes": result.uploadSizeBytes,
    "image.optimize.saved_bytes":
      result.originalSizeBytes - result.uploadSizeBytes,
    "image.optimize.output_type":
      result.file.type || "application/octet-stream",
    ...(result.width !== undefined && {
      "image.optimize.output_width": result.width,
    }),
    ...(result.height !== undefined && {
      "image.optimize.output_height": result.height,
    }),
  });
}

export async function optimizeImageForUpload(
  file: File,
  options: OptimizeImageForUploadOptions = {},
): Promise<OptimizedUploadImage> {
  const maxLongEdge = options.maxLongEdge ?? defaultMaxLongEdge;
  const quality = options.quality ?? defaultQuality;
  const mimeType = options.mimeType ?? defaultMimeType;
  const span = startFrontendSpan("client.image.optimize", {
    "image.optimize.input_name": file.name,
    "image.optimize.input_type": file.type || "application/octet-stream",
    "image.optimize.original_size_bytes": file.size,
    "image.optimize.target_mime_type": mimeType,
    "image.optimize.max_long_edge": maxLongEdge,
    "image.optimize.quality": quality,
    "image.optimize.can_optimize": canOptimizeImage(file),
  });

  if (
    typeof document === "undefined" ||
    typeof createImageBitmap !== "function" ||
    !canOptimizeImage(file)
  ) {
    const result = getOriginalUploadImage(file);
    setResultAttributes(span, result);
    span.end();
    return result;
  }

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    const size = getScaledSize({
      width: bitmap.width,
      height: bitmap.height,
      maxLongEdge,
    });
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;

    const context = canvas.getContext("2d");
    if (!context) {
      const result = getOriginalUploadImage(file);
      setResultAttributes(span, result);
      return result;
    }

    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await canvasToBlob(canvas, mimeType, quality);
    canvas.width = 0;
    canvas.height = 0;

    if (!blob || blob.size >= file.size) {
      const result = {
        ...getOriginalUploadImage(file),
        width: bitmap.width,
        height: bitmap.height,
      };
      setResultAttributes(span, result);
      return result;
    }

    const optimizedFile = new File(
      [blob],
      getOptimizedFileName(file.name, blob.type || mimeType),
      {
        type: blob.type || mimeType,
        lastModified: Date.now(),
      },
    );

    const result = {
      file: optimizedFile,
      originalFile: file,
      originalSizeBytes: file.size,
      uploadSizeBytes: optimizedFile.size,
      width: size.width,
      height: size.height,
      optimized: true,
    };
    setResultAttributes(span, result);
    return result;
  } catch (error) {
    recordSpanError(span, error);
    const result = getOriginalUploadImage(file);
    setResultAttributes(span, result);
    return result;
  } finally {
    bitmap?.close();
    span.end();
  }
}
