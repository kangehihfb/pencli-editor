import type { Point2D, Stroke, WebGLObject } from "../types/editor";
import { getImageFileId, getSharedImageUrl } from "./imageAssets";

type HandwritingSenderType = "STUDENT" | "MANAGER" | "SYSTEM";

type PentestActorRole = "student" | "teacher";

type SnapshotContext = {
  roomId: string;
  pageId: string;
  actorId?: string;
  actorRole?: PentestActorRole;
};

type MildangElementCustomData = {
  colorPickerEnabled: boolean;
  layerVersion: number;
  senderId?: string;
  senderName: string;
  senderType: HandwritingSenderType;
  imageUrl?: string;
  imageStorageKey?: string;
  imageThumbnailUrl?: string;
};

type MildangElementBase = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: "solid";
  strokeWidth: number;
  strokeStyle: "solid";
  roughness: number;
  opacity: number;
  roundness: null;
  seed: number;
  version: number;
  versionNonce: number;
  updated: number;
  isDeleted: boolean;
  groupIds: string[];
  frameId: null;
  boundElements: [];
  link: null;
  locked: boolean;
  customData: MildangElementCustomData;
};

export type MildangFreedrawElement = MildangElementBase & {
  type: "freedraw";
  points: Array<[number, number]>;
  pressures: number[];
  simulatePressure: boolean;
  lastCommittedPoint: null;
};

export type MildangTextElement = MildangElementBase & {
  type: "text";
  text: string;
  originalText: string;
  fontSize: number;
  fontFamily: string;
  textAlign: "left";
  verticalAlign: "top";
  baseline: number;
  containerId: null;
  lineHeight: number;
};

export type MildangImageElement = MildangElementBase & {
  type: "image";
  fileId: string | null;
  status: "pending" | "saved" | "error";
  scale: [number, number];
};

export type MildangHandwritingElement =
  | MildangFreedrawElement
  | MildangTextElement
  | MildangImageElement;

export type MildangExternalFileData = {
  id: string;
  url: string;
  mimeType?: string;
  storageKey?: string;
  thumbnailUrl?: string;
  created: number;
  sizeBytes?: number;
  sha256?: string;
};

export type MildangHandwritingData = {
  elements: MildangHandwritingElement[];
  files: Record<string, MildangExternalFileData>;
  appState: Record<string, unknown>;
};

export type PentestLoadedHandwritingState = {
  handwritingData: MildangHandwritingData;
  strokes: Stroke[];
  objects: WebGLObject[];
};

export type LocalHandwritingStoredFile = {
  savedAt: number;
  file: {
    id: string;
    url: string;
    name: string;
    type: string;
    size: number;
    lastModified: number;
  };
  text: string;
};

export type LocalHandwritingInput = {
  id: string;
  category: string;
  fileName: string;
  contentType: string;
};

export type LocalHandwritingResponse = {
  presignedUrl: string;
  file: {
    id: string;
    url: string;
  };
};

export type LocalHandwritingUploadResult = {
  handwriting: LocalHandwritingResponse;
  storedFile: LocalHandwritingStoredFile;
};

export const defaultPentestHandwritingStorageKey =
  "__pentest_handwriting_snapshot__";

const localPresignedUrlPrefix = "local-presigned://";
const localFileUrlPrefix = "localstorage://";

function cloneObjects(objects: WebGLObject[]): WebGLObject[] {
  return objects.map((object) => ({ ...object }));
}

function cloneStrokes(strokes: Stroke[]): Stroke[] {
  return strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => ({ ...point })),
  }));
}

function getSenderType(actorRole?: PentestActorRole): HandwritingSenderType {
  return actorRole === "teacher" ? "MANAGER" : "STUDENT";
}

function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

function stablePositiveInt(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash % 2_147_483_647) || 1;
}

function getFinitePoints(points: Point2D[]): Point2D[] {
  return points.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );
}

function getRawPointBounds(points: Point2D[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: Math.max(maxX - minX, 0.001),
    height: Math.max(maxY - minY, 0.001),
  };
}

function getCustomData(context: SnapshotContext): MildangElementCustomData {
  const senderType = getSenderType(context.actorRole);
  return {
    colorPickerEnabled: senderType === "STUDENT",
    layerVersion: 1,
    senderId: context.actorId,
    senderName: "",
    senderType,
  };
}

function getElementBase(input: {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  strokeWidth: number;
  context: SnapshotContext;
  updated: number;
}): Omit<MildangElementBase, "type"> {
  return {
    id: input.id,
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    angle: input.angle,
    strokeColor: input.strokeColor,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: input.strokeWidth,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    roundness: null,
    seed: stablePositiveInt(`${input.id}:seed`),
    version: 1,
    versionNonce: stablePositiveInt(`${input.id}:versionNonce`),
    updated: input.updated,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: [],
    link: null,
    locked: false,
    customData: getCustomData(input.context),
  };
}

export function toMildangFreedrawElement(
  stroke: Stroke,
  context: SnapshotContext,
  updated = Date.now(),
): MildangFreedrawElement | undefined {
  const points = getFinitePoints(stroke.points);
  if (points.length === 0) return undefined;

  const bounds = getRawPointBounds(points);
  return {
    ...getElementBase({
      id: stroke.id,
      x: bounds.minX,
      y: bounds.minY,
      width: bounds.width,
      height: bounds.height,
      angle: degToRad(stroke.rotation ?? 0),
      strokeColor: stroke.color,
      strokeWidth: stroke.size,
      context,
      updated,
    }),
    type: "freedraw",
    points: points.map((point) => [
      point.x - bounds.minX,
      point.y - bounds.minY,
    ]),
    pressures: [],
    simulatePressure: true,
    lastCommittedPoint: null,
  };
}

export function toMildangTextElement(
  object: WebGLObject,
  context: SnapshotContext,
  updated = Date.now(),
): MildangTextElement | undefined {
  if (object.kind !== "text") return undefined;

  const fontSize = object.fontSize ?? 24;
  const text = object.text ?? "";
  return {
    ...getElementBase({
      id: object.id,
      x: object.x - object.width / 2,
      y: object.y - object.height / 2,
      width: object.width,
      height: object.height,
      angle: degToRad(object.rotation ?? 0),
      strokeColor: object.color ?? "#202020",
      strokeWidth: 1,
      context,
      updated,
    }),
    type: "text",
    text,
    originalText: text,
    fontSize,
    fontFamily: object.fontFamily ?? "pretendard",
    textAlign: "left",
    verticalAlign: "top",
    baseline: Math.round(fontSize * 1.25),
    containerId: null,
    lineHeight: 1.25,
  };
}

export function toMildangImageElement(
  object: WebGLObject,
  context: SnapshotContext,
  updated = Date.now(),
): MildangImageElement | undefined {
  if (object.kind !== "image") return undefined;

  const imageUrl = getSharedImageUrl(object);
  const fileId = getImageFileId(object);
  if (!imageUrl || !fileId) return undefined;

  return {
    ...getElementBase({
      id: object.id,
      x: object.x - object.width / 2,
      y: object.y - object.height / 2,
      width: object.width,
      height: object.height,
      angle: degToRad(object.rotation ?? 0),
      strokeColor: "transparent",
      strokeWidth: 1,
      context,
      updated,
    }),
    type: "image",
    fileId,
    status: "saved",
    scale: [1, 1],
    customData: {
      ...getCustomData(context),
      imageUrl,
      imageStorageKey: object.imageStorageKey,
      imageThumbnailUrl: object.imageThumbnailUrl,
    },
  };
}

function createMildangAppState(): Record<string, unknown> {
  return {
    viewBackgroundColor: "transparent",
  };
}

export function createPentestHandwritingSnapshot(input: {
  strokes: Stroke[];
  objects: WebGLObject[];
  context: SnapshotContext;
}): MildangHandwritingData {
  const updated = Date.now();
  const strokeElements = cloneStrokes(input.strokes)
    .map((stroke) => toMildangFreedrawElement(stroke, input.context, updated))
    .filter((element): element is MildangFreedrawElement => Boolean(element));
  const textElements = cloneObjects(input.objects)
    .map((object) => toMildangTextElement(object, input.context, updated))
    .filter((element): element is MildangTextElement => Boolean(element));
  const imageElements = cloneObjects(input.objects)
    .map((object) => toMildangImageElement(object, input.context, updated))
    .filter((element): element is MildangImageElement => Boolean(element));
  const files = cloneObjects(input.objects).reduce<
    Record<string, MildangExternalFileData>
  >((nextFiles, object) => {
    if (object.kind !== "image") return nextFiles;

    const imageUrl = getSharedImageUrl(object);
    const fileId = getImageFileId(object);
    if (!imageUrl || !fileId) return nextFiles;

    nextFiles[fileId] = {
      id: fileId,
      url: imageUrl,
      mimeType: object.imageMimeType,
      storageKey: object.imageStorageKey,
      thumbnailUrl: object.imageThumbnailUrl,
      created: updated,
      sizeBytes: object.imageSizeBytes,
      sha256: object.imageSha256,
    };
    return nextFiles;
  }, {});

  return {
    elements: [...strokeElements, ...textElements, ...imageElements],
    files,
    appState: createMildangAppState(),
  };
}

function getLocalHandwritingStorageKey(input: LocalHandwritingInput): string {
  return [
    defaultPentestHandwritingStorageKey,
    input.category,
    input.id,
    input.fileName,
  ].join(":");
}

function encodeLocalUrl(prefix: string, key: string): string {
  return `${prefix}${encodeURIComponent(key)}`;
}

function decodeLocalUrl(url: string, prefix: string): string {
  if (!url.startsWith(prefix)) {
    throw new Error(`Unsupported local handwriting url: ${url}`);
  }
  return decodeURIComponent(url.slice(prefix.length));
}

function sanitizeFileNamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9가-힣_-]+/g, "-").replace(/^-|-$/g, "");
}

export function getPentestHandwritingFileName(input: {
  roomId: string;
  pageId: string;
}): string {
  const room = sanitizeFileNamePart(input.roomId) || "local-room";
  const page = sanitizeFileNamePart(input.pageId) || "page";
  return `handwriting-${room}-${page}.json`;
}

export function getPentestLocalHandwritingInput(input: {
  roomId: string;
  pageId: string;
}): LocalHandwritingInput {
  return {
    id: `${input.roomId}:${input.pageId}`,
    category: "PENTEST_LOCAL",
    fileName: getPentestHandwritingFileName(input),
    contentType: "application/json",
  };
}

export function getLocalHandwriting(
  input: LocalHandwritingInput,
): LocalHandwritingResponse {
  const key = getLocalHandwritingStorageKey(input);
  return {
    presignedUrl: encodeLocalUrl(localPresignedUrlPrefix, key),
    file: {
      id: key,
      url: encodeLocalUrl(localFileUrlPrefix, key),
    },
  };
}

export function convertMildangJsonToFile(
  jsonData: MildangHandwritingData,
  fileName: string,
): File {
  const jsonString = JSON.stringify(jsonData);
  const blob = new Blob([jsonString], { type: "application/json" });
  const jsonFile = new File([blob], fileName, {
    type: "application/json",
  });

  if (typeof DataTransfer === "undefined") return jsonFile;

  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(jsonFile);
  return dataTransfer.files.item(0) ?? jsonFile;
}

function isMildangHandwritingData(
  parsed: Partial<MildangHandwritingData>,
): parsed is MildangHandwritingData {
  return (
    Array.isArray(parsed.elements) &&
    Boolean(parsed.appState) &&
    Boolean(parsed.files)
  );
}

export function savePentestHandwritingSnapshot(
  input: LocalHandwritingInput,
  handwritingData: MildangHandwritingData,
): Promise<LocalHandwritingUploadResult> {
  const handwriting = getLocalHandwriting(input);
  const file = convertMildangJsonToFile(handwritingData, input.fileName);
  return savePentestHandwritingFile({
    presignedUrl: handwriting.presignedUrl,
    file,
  }).then((storedFile) => ({ handwriting, storedFile }));
}

export async function savePentestHandwritingFile(input: {
  presignedUrl: string;
  file: File;
}): Promise<LocalHandwritingStoredFile> {
  const key = decodeLocalUrl(input.presignedUrl, localPresignedUrlPrefix);
  const { file } = input;
  const text = await file.text();
  const storedFile: LocalHandwritingStoredFile = {
    savedAt: Date.now(),
    file: {
      id: key,
      url: encodeLocalUrl(localFileUrlPrefix, key),
      name: file.name,
      type: file.type || "application/json",
      size: file.size,
      lastModified: file.lastModified,
    },
    text,
  };
  window.localStorage.setItem(key, text);
  return storedFile;
}

export function fetchLocalHandwritingJson(url: string): unknown {
  const key = decodeLocalUrl(url, localFileUrlPrefix);
  const raw = window.localStorage.getItem(key);
  if (!raw) return undefined;

  const parsed = JSON.parse(raw) as unknown;
  if (
    parsed &&
    typeof parsed === "object" &&
    "text" in parsed &&
    typeof (parsed as Partial<LocalHandwritingStoredFile>).text === "string"
  ) {
    return JSON.parse(
      (parsed as Partial<LocalHandwritingStoredFile>).text ?? "",
    );
  }
  return parsed;
}

function fromMildangFreedrawElement(
  element: MildangFreedrawElement,
  layer: number,
): Stroke {
  return {
    id: element.id,
    kind: "stroke",
    points: element.points.map(([x, y]) => ({
      x: element.x + x,
      y: element.y + y,
    })),
    color: element.strokeColor,
    size: element.strokeWidth,
    rotation: radToDeg(element.angle),
    layer,
  };
}

function fromMildangTextElement(
  element: MildangTextElement,
  layer: number,
): WebGLObject {
  return {
    id: element.id,
    kind: "text",
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
    width: element.width,
    height: element.height,
    rotation: radToDeg(element.angle),
    layer,
    color: element.strokeColor,
    text: element.text,
    fontSize: element.fontSize,
    fontFamily: element.fontFamily,
  };
}

function fromMildangImageElement(
  element: MildangImageElement,
  files: Record<string, MildangExternalFileData>,
  layer: number,
): WebGLObject {
  const file = element.fileId ? files[element.fileId] : undefined;
  const imageUrl = file?.url ?? element.customData.imageUrl;
  const thumbnailUrl =
    file?.thumbnailUrl ?? element.customData.imageThumbnailUrl;
  return {
    id: element.id,
    kind: "image",
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
    width: element.width,
    height: element.height,
    rotation: radToDeg(element.angle),
    layer,
    imageSrc: imageUrl ?? thumbnailUrl,
    imageFileId: element.fileId ?? file?.id,
    imageUrl,
    imageThumbnailUrl: thumbnailUrl,
    imageStorageKey: file?.storageKey ?? element.customData.imageStorageKey,
    imageMimeType: file?.mimeType,
    imageSizeBytes: file?.sizeBytes,
    imageSha256: file?.sha256,
    imageStatus: imageUrl || thumbnailUrl ? "uploaded" : "error",
  };
}

export function parsePentestHandwritingSnapshot(
  parsed: unknown,
): PentestLoadedHandwritingState | undefined {
  const handwritingData = parsed as Partial<MildangHandwritingData> | undefined;
  if (!handwritingData || !isMildangHandwritingData(handwritingData)) {
    return undefined;
  }

  const elements = handwritingData.elements.filter(
    (element) => !element.isDeleted,
  );
  const strokes = elements
    .filter((element): element is MildangFreedrawElement =>
      Boolean(element && element.type === "freedraw"),
    )
    .map((element, index) => fromMildangFreedrawElement(element, index + 1));
  const objects = elements
    .filter((element): element is MildangTextElement =>
      Boolean(element && element.type === "text"),
    )
    .map((element, index) =>
      fromMildangTextElement(element, strokes.length + index + 1),
    );
  const imageObjects = elements
    .filter((element): element is MildangImageElement =>
      Boolean(element && element.type === "image"),
    )
    .map((element, index) =>
      fromMildangImageElement(
        element,
        handwritingData.files,
        strokes.length + objects.length + index + 1,
      ),
    );

  return {
    handwritingData,
    strokes,
    objects: [...objects, ...imageObjects],
  };
}

export function loadPentestHandwritingSnapshotFromUrl(
  url: string,
): PentestLoadedHandwritingState | undefined {
  return parsePentestHandwritingSnapshot(fetchLocalHandwritingJson(url));
}

export function loadPentestHandwritingSnapshot(
  input: LocalHandwritingInput,
): PentestLoadedHandwritingState | undefined {
  const { file } = getLocalHandwriting(input);
  return loadPentestHandwritingSnapshotFromUrl(file.url);
}
