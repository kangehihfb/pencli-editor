import type { WebGLObject } from "../types/editor";

export type ImageAssetReference = {
  fileId: string;
  url: string;
  thumbnailUrl?: string;
  storageKey?: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
};

export function isDataUrl(value: string | undefined): value is string {
  return Boolean(value?.startsWith("data:"));
}

export function isBlobUrl(value: string | undefined): value is string {
  return Boolean(value?.startsWith("blob:"));
}

export function isSharedImageUrl(value: string | undefined): value is string {
  if (!value) return false;
  return !isDataUrl(value) && !isBlobUrl(value);
}

export function getImageRenderSource(
  object: Pick<WebGLObject, "imageSrc" | "imageUrl" | "imageThumbnailUrl">,
): string | undefined {
  return object.imageSrc ?? object.imageUrl ?? object.imageThumbnailUrl;
}

export function getSharedImageUrl(object: WebGLObject): string | undefined {
  if (isSharedImageUrl(object.imageUrl)) return object.imageUrl;
  if (isSharedImageUrl(object.imageSrc)) return object.imageSrc;
  if (isSharedImageUrl(object.imageThumbnailUrl))
    return object.imageThumbnailUrl;
  return undefined;
}

export function getImageFileId(object: WebGLObject): string | undefined {
  if (object.kind !== "image") return undefined;
  return object.imageFileId ?? object.id;
}

export function getImageAssetReference(
  object: WebGLObject,
): ImageAssetReference | undefined {
  if (object.kind !== "image") return undefined;

  const url = getSharedImageUrl(object);
  const fileId = getImageFileId(object);
  if (!url || !fileId) return undefined;

  return {
    fileId,
    url,
    thumbnailUrl: object.imageThumbnailUrl,
    storageKey: object.imageStorageKey,
    mimeType: object.imageMimeType,
    sizeBytes: object.imageSizeBytes,
    sha256: object.imageSha256,
  };
}

export function toRealtimeImageObject(object: WebGLObject): WebGLObject {
  if (object.kind !== "image") return object;

  const {
    imageSrc,
    imageUrl,
    imageThumbnailUrl,
    imageStorageKey,
    imageMimeType,
    imageSizeBytes,
    imageSha256,
    ...rest
  } = object;
  const fileId = object.imageFileId ?? object.id;

  return {
    ...rest,
    imageFileId: fileId,
    imageName: object.imageName,
    imageStatus: getSharedImageUrl(object) ? "uploaded" : object.imageStatus,
  };
}

export function hydrateImageObject(
  object: WebGLObject,
  asset: ImageAssetReference | undefined,
): WebGLObject {
  if (object.kind !== "image" || !asset) return object;

  return {
    ...object,
    imageFileId: asset.fileId,
    imageUrl: asset.url,
    imageThumbnailUrl: asset.thumbnailUrl,
    imageStorageKey: asset.storageKey,
    imageMimeType: asset.mimeType,
    imageSizeBytes: asset.sizeBytes,
    imageSha256: asset.sha256,
    imageStatus: "uploaded",
  };
}
