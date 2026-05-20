import type { Span } from "@opentelemetry/api";
import type { Stroke, WebGLObject } from "../types/editor";
import {
  createPentestHandwritingSnapshot,
  parsePentestHandwritingSnapshot,
  type MildangHandwritingData,
  type PentestLoadedHandwritingState,
} from "./handwritingSnapshot";
import { recordSpanError, runWithFrontendSpan } from "./observability";
import {
  getStorageJson,
  transformStorageJson,
  uploadStorageJson,
  type StorageTraceResponse,
} from "./storageTraceClient";

type ProductActorRole = "student" | "teacher";

type ProductTraceBaseInput = {
  serverUrl: string;
  roomId: string;
  pageId: string;
  actorId: string;
  actorRole: ProductActorRole;
};

type ProductHandwritingInput = ProductTraceBaseInput & {
  strokes: Stroke[];
  objects: WebGLObject[];
};

export type ProductTraceResult = {
  ok: boolean;
  status: number;
  operation: string;
  key?: string;
  targetKey?: string;
  traceId?: string;
  elementsCount?: number;
  strokesCount?: number;
  objectsCount?: number;
  loaded?: PentestLoadedHandwritingState;
  data?: unknown;
};

function sanitizeKeyPart(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9가-힣:_-]+/g, "-")
      .replace(/^-|-$/g, "") || "unknown"
  );
}

export function makeProductHandwritingKey(input: {
  roomId: string;
  pageId: string;
}): string {
  return [
    "mildang-product",
    "handwriting",
    sanitizeKeyPart(input.roomId),
    `${sanitizeKeyPart(input.pageId)}.json`,
  ].join("/");
}

function makeFrameActivityKey(input: { roomId: string; pageId: string }) {
  return [
    "mildang-product",
    "frame-activity",
    sanitizeKeyPart(input.roomId),
    `${sanitizeKeyPart(input.pageId)}-internal-data.json`,
  ].join("/");
}

function getTraceId(span: Span): string {
  return span.spanContext().traceId;
}

function markStorageFailure(span: Span, response: StorageTraceResponse): void {
  if (response.ok) return;
  const message =
    response.data &&
    typeof response.data === "object" &&
    "message" in response.data
      ? String((response.data as { message?: unknown }).message)
      : `${response.operation} failed with ${response.status}`;
  recordSpanError(span, message);
}

function getStorageJsonPayload(data: unknown): unknown {
  if (!data || typeof data !== "object") return undefined;
  if ("json" in data) return (data as { json?: unknown }).json;
  return undefined;
}

function getHandwritingData(data: unknown): MildangHandwritingData | undefined {
  const payload = getStorageJsonPayload(data);
  if (!payload || typeof payload !== "object") return undefined;
  if ("handwritingData" in payload) {
    return (payload as { handwritingData?: MildangHandwritingData })
      .handwritingData;
  }
  return payload as MildangHandwritingData;
}

function toProductResult(input: {
  response: StorageTraceResponse;
  operation: string;
  traceId: string;
  elementsCount?: number;
  strokesCount?: number;
  objectsCount?: number;
  loaded?: PentestLoadedHandwritingState;
}): ProductTraceResult {
  return {
    ok: input.response.ok,
    status: input.response.status,
    operation: input.operation,
    key: input.response.key,
    targetKey: input.response.targetKey,
    traceId: input.traceId,
    elementsCount: input.elementsCount,
    strokesCount: input.strokesCount,
    objectsCount: input.objectsCount,
    loaded: input.loaded,
    data: input.response.data,
  };
}

export async function saveProductHandwriting(
  input: ProductHandwritingInput,
): Promise<ProductTraceResult> {
  return runWithFrontendSpan(
    "product.handwriting.updateStudyActivityInstanceHandwriting",
    {
      "graphql.operation.type": "mutation",
      "graphql.operation.name": "UpdateStudyActivityInstanceHandwriting",
      "study_activity_instance.id": input.pageId,
      "room.id": input.roomId,
      "actor.id": input.actorId,
      "actor.role": input.actorRole,
      "handwriting.strokes.count": input.strokes.length,
      "handwriting.objects.count": input.objects.length,
    },
    async (span) => {
      const handwritingData = createPentestHandwritingSnapshot({
        strokes: input.strokes,
        objects: input.objects,
        context: {
          roomId: input.roomId,
          pageId: input.pageId,
          actorId: input.actorId,
          actorRole: input.actorRole,
        },
      });
      const key = makeProductHandwritingKey(input);

      span.setAttributes({
        "aws.s3.key": key,
        "handwriting.elements.count": handwritingData.elements.length,
      });

      const response = await uploadStorageJson({
        serverUrl: input.serverUrl,
        key,
        json: {
          __typename: "StudyActivityInstanceHandwriting",
          studyActivityInstanceId: input.pageId,
          roomId: input.roomId,
          actorId: input.actorId,
          actorRole: input.actorRole,
          handwritingData,
          savedAt: new Date().toISOString(),
        },
      });

      markStorageFailure(span, response);
      span.setAttribute("http.response.status_code", response.status);

      return toProductResult({
        response,
        operation: "handwriting.save",
        traceId: getTraceId(span),
        elementsCount: handwritingData.elements.length,
        strokesCount: input.strokes.length,
        objectsCount: input.objects.length,
      });
    },
  );
}

export async function loadProductHandwriting(
  input: ProductTraceBaseInput & { key?: string },
): Promise<ProductTraceResult> {
  return runWithFrontendSpan(
    "product.handwriting.studyActivityInstanceById",
    {
      "graphql.operation.type": "query",
      "graphql.operation.name": "StudentNoteEditor",
      "study_activity_instance.id": input.pageId,
      "room.id": input.roomId,
      "actor.id": input.actorId,
      "actor.role": input.actorRole,
    },
    async (span) => {
      const key = input.key ?? makeProductHandwritingKey(input);
      span.setAttribute("aws.s3.key", key);

      const response = await getStorageJson({
        serverUrl: input.serverUrl,
        key,
      });
      markStorageFailure(span, response);
      span.setAttribute("http.response.status_code", response.status);

      const handwritingData = getHandwritingData(response.data);
      const loaded = handwritingData
        ? parsePentestHandwritingSnapshot(handwritingData)
        : undefined;

      if (response.ok && !loaded) {
        recordSpanError(span, "storage object did not contain handwritingData");
      }

      return toProductResult({
        response,
        operation: "handwriting.load",
        traceId: getTraceId(span),
        elementsCount: loaded?.handwritingData.elements.length,
        strokesCount: loaded?.strokes.length,
        objectsCount: loaded?.objects.length,
        loaded,
      });
    },
  );
}

export async function transformProductHandwriting(
  input: ProductTraceBaseInput & { sourceKey: string },
): Promise<ProductTraceResult> {
  return runWithFrontendSpan(
    "product.handwriting.storageJsonTransform",
    {
      "graphql.operation.type": "mutation",
      "graphql.operation.name": "TransformStudyActivityInstanceHandwritingJson",
      "study_activity_instance.id": input.pageId,
      "room.id": input.roomId,
      "actor.id": input.actorId,
      "actor.role": input.actorRole,
      "aws.s3.source_key": input.sourceKey,
    },
    async (span) => {
      const targetKey = input.sourceKey.replace(/\.json$/, "-transformed.json");
      span.setAttribute("aws.s3.target_key", targetKey);

      const response = await transformStorageJson({
        serverUrl: input.serverUrl,
        sourceKey: input.sourceKey,
        targetKey,
        patch: {
          transformKind: "product-handwriting-json",
          reviewed: true,
          transformedByActorId: input.actorId,
        },
      });

      markStorageFailure(span, response);
      span.setAttribute("http.response.status_code", response.status);

      return toProductResult({
        response,
        operation: "handwriting.transform",
        traceId: getTraceId(span),
      });
    },
  );
}

export async function runFrameActivityInternalDataFlow(
  input: ProductTraceBaseInput,
): Promise<ProductTraceResult> {
  return runWithFrontendSpan(
    "product.frameActivity.saveWebContentInternalData",
    {
      "graphql.operation.type": "mutation",
      "graphql.operation.name": "SaveWebContentInternalData",
      "learning_activity.id": input.pageId,
      "room.id": input.roomId,
      "actor.id": input.actorId,
      "actor.role": input.actorRole,
    },
    async (span) => {
      const key = makeFrameActivityKey(input);

      await runWithFrontendSpan(
        "product.frameActivity.generatePresignedUrlForFile",
        {
          "graphql.operation.type": "query",
          "graphql.operation.name": "GeneratePresignedUrlForFile",
          "file.name": "frame-activity-internal-data.json",
          "file.mime_type": "application/json",
          "aws.s3.key": key,
        },
        async (presignSpan) => {
          presignSpan.setAttribute("presigned_url.kind", "local-minio-json");
          return true;
        },
      );

      const response = await uploadStorageJson({
        serverUrl: input.serverUrl,
        key,
        json: {
          __typename: "WebContentInternalData",
          learningActivityId: input.pageId,
          key: "frame-activity-sdk:state",
          value: {
            answers: [{ id: "q1", value: "A" }],
            savedBy: input.actorId,
            savedAt: new Date().toISOString(),
          },
        },
      });

      markStorageFailure(span, response);
      span.setAttribute("http.response.status_code", response.status);

      return toProductResult({
        response,
        operation: "frame-activity.save",
        traceId: getTraceId(span),
      });
    },
  );
}
