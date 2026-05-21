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

const defaultMaxLongEdge = 2048;
const defaultQuality = 0.82;
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

export async function optimizeImageForUpload(
  file: File,
  options: OptimizeImageForUploadOptions = {},
): Promise<OptimizedUploadImage> {
  if (
    typeof document === "undefined" ||
    typeof createImageBitmap !== "function" ||
    !canOptimizeImage(file)
  ) {
    return getOriginalUploadImage(file);
  }

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    const maxLongEdge = options.maxLongEdge ?? defaultMaxLongEdge;
    const quality = options.quality ?? defaultQuality;
    const mimeType = options.mimeType ?? defaultMimeType;
    const size = getScaledSize({
      width: bitmap.width,
      height: bitmap.height,
      maxLongEdge,
    });
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;

    const context = canvas.getContext("2d");
    if (!context) return getOriginalUploadImage(file);

    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await canvasToBlob(canvas, mimeType, quality);
    canvas.width = 0;
    canvas.height = 0;

    if (!blob || blob.size >= file.size) {
      return {
        ...getOriginalUploadImage(file),
        width: bitmap.width,
        height: bitmap.height,
      };
    }

    const optimizedFile = new File(
      [blob],
      getOptimizedFileName(file.name, blob.type || mimeType),
      {
        type: blob.type || mimeType,
        lastModified: Date.now(),
      },
    );

    return {
      file: optimizedFile,
      originalFile: file,
      originalSizeBytes: file.size,
      uploadSizeBytes: optimizedFile.size,
      width: size.width,
      height: size.height,
      optimized: true,
    };
  } catch {
    return getOriginalUploadImage(file);
  } finally {
    bitmap?.close();
  }
}
