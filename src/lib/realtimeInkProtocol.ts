import type { Point2D, Stroke, WebGLObject } from "../types/editor";

export type RealtimeInkStatus =
  | "disabled"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type RealtimeInkRole = "teacher" | "student";

export type RealtimeInkConfiguration = {
  enabled: boolean;
  serverUrl: string;
  roomId: string;
  pageId: string;
  token: string;
  actorId: string;
  actorRole: RealtimeInkRole;
  receiveTraceSampleRate: number;
};

export type StrokeStyle = {
  color: string;
  size: number;
  layer?: number;
};

export type CollaborativeStroke = Stroke & {
  pageId: string;
  actorId: string;
  actorRole: RealtimeInkRole;
  createdAt: number;
};

export type CollaborativeObject = WebGLObject & {
  pageId: string;
  actorId: string;
  actorRole: RealtimeInkRole;
  updatedAt: number;
};

export type CollaborativeAsset = {
  fileId: string;
  url: string;
  thumbnailUrl?: string;
  storageKey?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  sha256?: string;
  pageId: string;
  actorId: string;
  actorRole: RealtimeInkRole;
  updatedAt: number;
};

export type RealtimeInkYjsDebug = {
  strokeCount: number;
  remoteStrokeCount: number;
  objectCount: number;
  remoteObjectCount: number;
  assetCount: number;
  localUpdateCount: number;
  remoteUpdateCount: number;
  sentUpdateCount: number;
  appliedUpdateCount: number;
  syncRequestCount: number;
  syncResponseCount: number;
  syncAppliedCount: number;
  lastLocalUpdateAt: number | undefined;
  lastRemoteUpdateAt: number | undefined;
  lastSyncAt: number | undefined;
};

export type RealtimeInkMessage =
  | {
      protocol: typeof protocolName;
      version: 1;
      type: "ink:stroke:start";
      roomId: string;
      pageId: string;
      actorId: string;
      actorRole: RealtimeInkRole;
      strokeId: string;
      color: string;
      size: number;
      layer: number;
      point: Point2D;
    }
  | {
      protocol: typeof protocolName;
      version: 1;
      type: "ink:stroke:append";
      roomId: string;
      pageId: string;
      actorId: string;
      actorRole: RealtimeInkRole;
      strokeId: string;
      seq: number;
      color: string;
      size: number;
      layer: number;
      points: Point2D[];
    }
  | {
      protocol: typeof protocolName;
      version: 1;
      type: "ink:stroke:end";
      roomId: string;
      pageId: string;
      actorId: string;
      actorRole: RealtimeInkRole;
      strokeId: string;
      points: Point2D[];
    }
  | {
      protocol: typeof protocolName;
      version: 1;
      type: "yjs:update";
      roomId: string;
      pageId: string;
      actorId: string;
      update?: number[];
      updateBase64?: string;
    }
  | {
      protocol: typeof protocolName;
      version: 1;
      type: "image:ready";
      roomId: string;
      pageId: string;
      actorId: string;
      actorRole: RealtimeInkRole;
      object: WebGLObject;
      asset: Omit<
        CollaborativeAsset,
        "pageId" | "actorId" | "actorRole" | "updatedAt"
      >;
    }
  | {
      protocol: typeof protocolName;
      version: 1;
      type: "image:preview";
      roomId: string;
      pageId: string;
      actorId: string;
      actorRole: RealtimeInkRole;
      object: WebGLObject;
      previewDataUrl: string;
      previewBytes: number;
      mimeType?: string;
    }
  | {
      protocol: typeof protocolName;
      version: 1;
      type: "yjs:sync-request";
      roomId: string;
      pageId: string;
      actorId: string;
      requestId: string;
    }
  | {
      protocol: typeof protocolName;
      version: 1;
      type: "yjs:sync-response";
      roomId: string;
      pageId: string;
      actorId: string;
      targetActorId: string;
      requestId: string;
      update?: number[];
      updateBase64?: string;
    };

export const protocolName = "pentest-ink";
export const socketPath = "/handwriting/socket.io/";
export const batchIntervalMs = 50;
export const syncRequestDelayMs = 250;
export const defaultRemoteLayer = 50;
export const localYjsOrigin = "pentest-ink-local-yjs";
export const remoteYjsOrigin = "pentest-ink-remote-yjs";

const strokePointCoordinateScale = 100;
const defaultInkServerUrl = "http://localhost:3000";
const defaultActivityId = "local-activity";
const defaultQuestionId = "question-1";
const defaultPageId = "page-1";
const defaultRole: RealtimeInkRole = "student";
const defaultReceiveTraceSampleRate = 1;

function isTruthyDebugFlag(value: string | null | undefined): boolean {
  return value === "" || value === "1" || value === "true";
}

function isStrokePointDebugEnabled(): boolean {
  if (typeof globalThis.location === "undefined") return false;

  const parameters = new URLSearchParams(globalThis.location.search);
  if (isTruthyDebugFlag(parameters.get("pointDebug"))) return true;

  try {
    return isTruthyDebugFlag(globalThis.localStorage?.getItem("pointDebug"));
  } catch {
    return false;
  }
}

export const initialYjsDebug: RealtimeInkYjsDebug = {
  strokeCount: 0,
  remoteStrokeCount: 0,
  objectCount: 0,
  remoteObjectCount: 0,
  assetCount: 0,
  localUpdateCount: 0,
  remoteUpdateCount: 0,
  sentUpdateCount: 0,
  appliedUpdateCount: 0,
  syncRequestCount: 0,
  syncResponseCount: 0,
  syncAppliedCount: 0,
  lastLocalUpdateAt: undefined,
  lastRemoteUpdateAt: undefined,
  lastSyncAt: undefined,
};

export function makeRealtimeId(prefix: string): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (randomUUID) return `${prefix}_${randomUUID.call(globalThis.crypto)}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}`;
}

export function normalizeStrokePointCoordinate(value: number): number {
  if (!Number.isFinite(value)) return value;

  const rounded =
    Math.round(value * strokePointCoordinateScale) / strokePointCoordinateScale;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function normalizeStrokePoint(point: Point2D): Point2D {
  const normalizedPoint = {
    x: normalizeStrokePointCoordinate(point.x),
    y: normalizeStrokePointCoordinate(point.y),
  };

  if (isStrokePointDebugEnabled()) {
    console.log("[stroke-point-normalize]", {
      raw: point,
      normalized: normalizedPoint,
      changed: normalizedPoint.x !== point.x || normalizedPoint.y !== point.y,
    });
  }

  return normalizedPoint;
}

export function normalizeStrokePoints(points: Point2D[]): Point2D[] {
  return points.map(normalizeStrokePoint);
}

export function readRealtimeInkConfiguration(): RealtimeInkConfiguration {
  const parameters = new URLSearchParams(globalThis.location.search);
  const enabled =
    parameters.get("realtimeInk") === "1" ||
    parameters.get("realtimeInk") === "true";
  const actorRole =
    parameters.get("inkRole") === "teacher" ? "teacher" : defaultRole;
  const activityId = parameters.get("inkActivity") ?? defaultActivityId;
  const questionId = parameters.get("inkQuestion") ?? defaultQuestionId;
  const pageId = parameters.get("inkPage") ?? defaultPageId;
  const roomId =
    parameters.get("inkRoom") ??
    `activity:${activityId}:question:${questionId}:page:${pageId}`;

  return {
    enabled,
    serverUrl: parameters.get("inkServer") ?? defaultInkServerUrl,
    roomId,
    pageId,
    token: parameters.get("inkToken") ?? "",
    actorId: parameters.get("inkActor") ?? getOrCreateSessionActorId(),
    actorRole,
    receiveTraceSampleRate: readSampleRate(
      parameters.get("inkTraceReceiveSampleRate"),
      defaultReceiveTraceSampleRate,
    ),
  };
}

function readSampleRate(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

export function encodeMessage(message: RealtimeInkMessage): ArrayBuffer {
  return toExactArrayBuffer(new TextEncoder().encode(JSON.stringify(message)));
}

export function encodeYjsUpdateBase64(update: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < update.length; index += chunkSize) {
    const chunk = update.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function decodeYjsUpdateBytes(
  message: Extract<
    RealtimeInkMessage,
    { type: "yjs:update" | "yjs:sync-response" }
  >,
): Uint8Array | undefined {
  if (message.updateBase64) {
    const binary = atob(message.updateBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  return message.update ? new Uint8Array(message.update) : undefined;
}

export function decodeMessage(data: unknown): RealtimeInkMessage | undefined {
  try {
    if (typeof data === "string") {
      return JSON.parse(data) as RealtimeInkMessage;
    }

    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : ArrayBuffer.isView(data)
          ? getViewBytes(data)
          : undefined;

    if (!bytes) return undefined;
    return JSON.parse(new TextDecoder().decode(bytes)) as RealtimeInkMessage;
  } catch {
    return undefined;
  }
}

export function isRealtimeInkMessage(
  message: RealtimeInkMessage | undefined,
): message is RealtimeInkMessage {
  return message?.protocol === protocolName && message.version === 1;
}

export function appendUniquePoints(
  existingPoints: Point2D[],
  nextPoints: Point2D[],
): Point2D[] {
  const merged = [...existingPoints];
  for (const point of nextPoints) {
    const previous = merged[merged.length - 1];
    if (previous && previous.x === point.x && previous.y === point.y) continue;
    merged.push(point);
  }
  return merged;
}

function getOrCreateSessionActorId(): string {
  const key = "pentest-ink-actor-id";
  const stored = globalThis.sessionStorage?.getItem(key);
  if (stored) return stored;
  const next = makeRealtimeId("actor");
  globalThis.sessionStorage?.setItem(key, next);
  return next;
}

function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function getViewBytes(data: ArrayBufferView): Uint8Array {
  const buffer = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
  return new Uint8Array(buffer);
}
