import {
  makeTraceCarrier,
  recordSpanError,
  startFrontendSpan,
} from "./observability";

export type StorageTraceResponse = {
  ok: boolean;
  status: number;
  operation: string;
  key?: string;
  targetKey?: string;
  traceparent?: string;
  data?: unknown;
};

export type StorageAssetUploadResponse = StorageTraceResponse & {
  bucket?: string;
  assetId?: string;
  objectUrl?: string;
  assetUrl?: string;
  presignedGetUrl?: string;
  presignedExpiresIn?: number;
  contentType?: string;
  sizeBytes?: number;
  sha256?: string;
  etag?: string;
};

type StorageFetchInput = {
  serverUrl: string;
  operation: string;
  spanName: string;
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  attributes?: Record<string, string | number | boolean | undefined>;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function getStorageServerUrl(serverUrl: string): string {
  const parameters = new URLSearchParams(globalThis.location.search);
  return trimTrailingSlash(
    parameters.get("storageServer") || serverUrl || "http://127.0.0.1:3000",
  );
}

function getResponseKey(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const key = (data as { key?: unknown }).key;
  return typeof key === "string" ? key : undefined;
}

function getResponseTargetKey(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const targetKey = (data as { targetKey?: unknown }).targetKey;
  return typeof targetKey === "string" ? targetKey : undefined;
}

function getResponseString(data: unknown, key: string): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function getResponseNumber(data: unknown, key: string): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

async function fetchStorageTrace(
  input: StorageFetchInput,
): Promise<StorageTraceResponse> {
  const url = `${getStorageServerUrl(input.serverUrl)}${input.path}`;
  const bodyText =
    input.body === undefined ? undefined : JSON.stringify(input.body);
  const span = startFrontendSpan(input.spanName, {
    "http.request.method": input.method || "GET",
    "url.full": url,
    "storage.operation": input.operation,
    "http.request.body.size": bodyText
      ? new TextEncoder().encode(bodyText).byteLength
      : 0,
    ...input.attributes,
  });
  const traceCarrier = makeTraceCarrier(span);
  span.setAttribute("traceparent", traceCarrier.traceparent ?? "");

  try {
    const response = await fetch(url, {
      method: input.method || "GET",
      headers: {
        "content-type": "application/json",
        ...traceCarrier,
      },
      body: bodyText,
    });
    const responseText = await response.text();
    const data = responseText ? JSON.parse(responseText) : undefined;

    span.setAttributes({
      "http.response.status_code": response.status,
      "http.response.body.size": new TextEncoder().encode(responseText)
        .byteLength,
    });

    if (!response.ok) {
      recordSpanError(
        span,
        data && typeof data === "object" && "message" in data
          ? String((data as { message?: unknown }).message)
          : `storage request failed with ${response.status}`,
      );
    }

    return {
      ok: response.ok,
      status: response.status,
      operation: input.operation,
      key: getResponseKey(data),
      targetKey: getResponseTargetKey(data),
      traceparent: traceCarrier.traceparent,
      data,
    };
  } catch (error) {
    recordSpanError(span, error);
    throw error;
  } finally {
    span.end();
  }
}

export function makeStorageDemoKey(prefix: string): string {
  return `json/frontend-${prefix}-${Date.now().toString(36)}.json`;
}

function sanitizeStorageKeyPart(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9가-힣._:-]+/g, "-")
      .replace(/^-|-$/g, "") || "unknown"
  );
}

function getFileExtension(fileName: string, contentType: string): string {
  const fileExtension = fileName.split(".").pop();
  if (fileExtension && fileExtension !== fileName) {
    return sanitizeStorageKeyPart(fileExtension.toLowerCase());
  }

  const mimeExtension = contentType.split("/").pop();
  return sanitizeStorageKeyPart(mimeExtension || "bin");
}

export function makeStorageAssetKey(input: {
  roomId: string;
  pageId: string;
  fileId: string;
  fileName: string;
  contentType: string;
}): string {
  return [
    "mildang-product",
    "handwriting-assets",
    sanitizeStorageKeyPart(input.roomId),
    sanitizeStorageKeyPart(input.pageId),
    `${sanitizeStorageKeyPart(input.fileId)}.${getFileExtension(
      input.fileName,
      input.contentType,
    )}`,
  ].join("/");
}

export function checkStorageHealth(serverUrl: string) {
  return fetchStorageTrace({
    serverUrl,
    operation: "health",
    spanName: "client.storage.health",
    path: "/test/storage-json/health",
  });
}

export function uploadStorageJson(input: {
  serverUrl: string;
  key: string;
  json: unknown;
}) {
  return fetchStorageTrace({
    serverUrl: input.serverUrl,
    operation: "put-json",
    spanName: "client.storage.put-json",
    path: "/test/storage-json",
    method: "POST",
    body: {
      key: input.key,
      json: input.json,
    },
    attributes: {
      "aws.s3.key": input.key,
    },
  });
}

export async function uploadStorageAsset(input: {
  serverUrl: string;
  key: string;
  file: File;
}): Promise<StorageAssetUploadResponse> {
  const url = `${getStorageServerUrl(input.serverUrl)}/test/storage-asset?key=${encodeURIComponent(
    input.key,
  )}`;
  const span = startFrontendSpan("client.storage.put-asset", {
    "http.request.method": "POST",
    "url.full": url,
    "storage.operation": "put-asset",
    "aws.s3.key": input.key,
    "file.name": input.file.name,
    "file.type": input.file.type || "application/octet-stream",
    "file.size": input.file.size,
    "http.request.body.size": input.file.size,
  });
  const traceCarrier = makeTraceCarrier(span);
  span.setAttribute("traceparent", traceCarrier.traceparent ?? "");

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": input.file.type || "application/octet-stream",
        "x-file-name": input.file.name,
        ...traceCarrier,
      },
      body: input.file,
    });
    const responseText = await response.text();
    const data = responseText ? JSON.parse(responseText) : undefined;

    span.setAttributes({
      "http.response.status_code": response.status,
      "http.response.body.size": new TextEncoder().encode(responseText)
        .byteLength,
    });

    if (!response.ok) {
      recordSpanError(
        span,
        data && typeof data === "object" && "message" in data
          ? String((data as { message?: unknown }).message)
          : `asset upload failed with ${response.status}`,
      );
    }

    return {
      ok: response.ok,
      status: response.status,
      operation: "put-asset",
      key: getResponseKey(data),
      traceparent: traceCarrier.traceparent,
      data,
      bucket: getResponseString(data, "bucket"),
      assetId: getResponseString(data, "assetId"),
      objectUrl: getResponseString(data, "objectUrl"),
      assetUrl: getResponseString(data, "assetUrl"),
      presignedGetUrl: getResponseString(data, "presignedGetUrl"),
      presignedExpiresIn: getResponseNumber(data, "presignedExpiresIn"),
      contentType: getResponseString(data, "contentType"),
      sizeBytes: getResponseNumber(data, "sizeBytes"),
      sha256: getResponseString(data, "sha256"),
      etag: getResponseString(data, "etag"),
    };
  } catch (error) {
    recordSpanError(span, error);
    throw error;
  } finally {
    span.end();
  }
}

export function getStorageJson(input: { serverUrl: string; key: string }) {
  return fetchStorageTrace({
    serverUrl: input.serverUrl,
    operation: "get-json",
    spanName: "client.storage.get-json",
    path: `/test/storage-json?key=${encodeURIComponent(input.key)}`,
    attributes: {
      "aws.s3.key": input.key,
    },
  });
}

export function transformStorageJson(input: {
  serverUrl: string;
  sourceKey: string;
  targetKey: string;
  patch: Record<string, unknown>;
}) {
  return fetchStorageTrace({
    serverUrl: input.serverUrl,
    operation: "transform-json",
    spanName: "client.storage.transform-json",
    path: "/test/storage-transform",
    method: "POST",
    body: {
      sourceKey: input.sourceKey,
      targetKey: input.targetKey,
      patch: input.patch,
    },
    attributes: {
      "aws.s3.source_key": input.sourceKey,
      "aws.s3.target_key": input.targetKey,
    },
  });
}
