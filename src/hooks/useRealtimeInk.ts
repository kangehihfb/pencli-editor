import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { Point2D, Stroke, WebGLObject } from "../types/editor";
import useRealtimeInkDocument from "./useRealtimeInkDocument";
import type { Span } from "@opentelemetry/api";
import {
  makeTraceCarrier,
  recordSpanError,
  startFrontendSpan,
  startFrontendSpanFromCarrier,
  type TraceCarrier,
} from "../lib/observability";
import {
  getImageAssetReference,
  hydrateImageObject,
  toRealtimeImageObject,
} from "../lib/imageAssets";
import { getNextStrokePointBatch } from "../lib/sceneMath";
import {
  batchIntervalMs,
  decodeMessage,
  decodeYjsUpdateBytes,
  defaultRemoteLayer,
  encodeMessage,
  encodeYjsUpdateBase64,
  isRealtimeInkMessage,
  makeRealtimeId,
  normalizeStrokePoint,
  normalizeStrokePoints,
  protocolName,
  readRealtimeInkConfiguration,
  socketPath,
  syncRequestDelayMs,
  type CollaborativeAsset,
  type RealtimeInkMessage,
  type RealtimeInkStatus,
  type StrokeStyle,
} from "../lib/realtimeInkProtocol";

type RealtimeInkReceiveDiagnostics = {
  startedAt: string;
  received: number;
  invalid: number;
  ignored: number;
  applied: number;
  errors: number;
  byType: Record<string, number>;
  appliedByType: Record<string, number>;
  handlerMs: {
    count: number;
    average: number;
    max: number;
  };
  lastMessageAt?: string;
  lastAppliedAt?: string;
  lastError?: string;
};

declare global {
  interface Window {
    __realtimeInkReceiveDiagnostics?: RealtimeInkReceiveDiagnostics;
  }
}

function createReceiveDiagnostics(): RealtimeInkReceiveDiagnostics {
  return {
    startedAt: new Date().toISOString(),
    received: 0,
    invalid: 0,
    ignored: 0,
    applied: 0,
    errors: 0,
    byType: {},
    appliedByType: {},
    handlerMs: {
      count: 0,
      average: 0,
      max: 0,
    },
  };
}

function recordHandlerDuration(
  diagnostics: RealtimeInkReceiveDiagnostics,
  durationMs: number,
) {
  const nextCount = diagnostics.handlerMs.count + 1;
  diagnostics.handlerMs.average =
    (diagnostics.handlerMs.average * diagnostics.handlerMs.count + durationMs) /
    nextCount;
  diagnostics.handlerMs.count = nextCount;
  diagnostics.handlerMs.max = Math.max(diagnostics.handlerMs.max, durationMs);
}

function getPayloadBytes(payload: unknown): number | undefined {
  if (typeof payload === "string") {
    return new TextEncoder().encode(payload).byteLength;
  }
  if (payload instanceof ArrayBuffer) return payload.byteLength;
  if (ArrayBuffer.isView(payload)) return payload.byteLength;
  return undefined;
}

function isTraceCarrier(value: unknown): value is TraceCarrier {
  return (
    typeof value === "object" &&
    value !== null &&
    "traceparent" in value &&
    typeof (value as TraceCarrier).traceparent === "string"
  );
}

function shouldSampleTrace(sampleRate: number, stableKey: string): boolean {
  if (sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;

  let hash = 2166136261;
  for (let index = 0; index < stableKey.length; index += 1) {
    hash ^= stableKey.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff < sampleRate;
}

export function useRealtimeInk() {
  const configuration = useMemo(readRealtimeInkConfiguration, []);
  const socketReference = useRef<Socket | undefined>();
  const receiveDiagnosticsReference = useRef(createReceiveDiagnostics());
  const activeStrokeReference = useRef<
    | {
        id: string;
        seq: number;
        color: string;
        size: number;
        layer: number;
        points: Point2D[];
      }
    | undefined
  >();
  const pendingPointsReference = useRef<Point2D[]>([]);
  const flushTimerReference = useRef<number | undefined>();
  const syncRequestTimerReference = useRef<number | undefined>();
  const activeStrokeSpanReference = useRef<Span | undefined>();
  const strokeBeginTimeReference = useRef<number | undefined>();
  // 4-3: cold start — join-room emit ~ 첫 client-broadcast 수신
  const coldStartSpanReference = useRef<Span | undefined>();
  const coldStartBeginTimeReference = useRef<number | undefined>();
  // 4-4: 재연결 추적 — disconnect ~ reconnect
  const reconnectBeginTimeReference = useRef<number | undefined>();
  const reconnectCountReference = useRef<number>(0);
  const [status, setStatus] = useState<RealtimeInkStatus>(
    configuration.enabled ? "connecting" : "disabled",
  );
  const [remoteStrokes, setRemoteStrokes] = useState<Stroke[]>([]);
  const [remoteObjects, setRemoteObjects] = useState<WebGLObject[]>([]);

  const emitMessage = useCallback(
    (
      eventName: "server-broadcast" | "server-volatile-broadcast",
      message: RealtimeInkMessage,
    ) => {
      const socket = socketReference.current;
      const payload = encodeMessage(message);

      // volatile broadcast는 획 이동 중 고빈도로 발생하므로 span 생략
      if (eventName === "server-volatile-broadcast") {
        if (!socket?.connected) return;
        socket.emit(
          eventName,
          configuration.roomId,
          payload,
          new Uint8Array(),
          {},
        );
        return;
      }

      const span = startFrontendSpan(`client.socket.${eventName}`, {
        "messaging.system": "socket.io",
        "messaging.destination.name": configuration.roomId,
        "socket.event": eventName,
        "socket.connected": Boolean(socket?.connected),
        "room.id": configuration.roomId,
        "realtime.message.type": message.type,
        "realtime.actor.id": configuration.actorId,
        "realtime.actor.role": configuration.actorRole,
        "payload.bytes": payload.byteLength,
      });

      if (!socket?.connected) {
        recordSpanError(span, "socket is not connected");
        span.end();
        return;
      }

      const traceCarrier = makeTraceCarrier(span);
      span.setAttribute("traceparent", traceCarrier.traceparent ?? "");

      try {
        socket.emit(
          eventName,
          configuration.roomId,
          payload,
          new Uint8Array(),
          traceCarrier,
        );
      } catch (error) {
        recordSpanError(span, error);
        throw error;
      } finally {
        span.end();
      }
    },
    [configuration.actorId, configuration.actorRole, configuration.roomId],
  );

  const handleLocalYjsUpdate = useCallback(
    (update: Uint8Array) => {
      emitMessage("server-broadcast", {
        protocol: protocolName,
        version: 1,
        type: "yjs:update",
        roomId: configuration.roomId,
        pageId: configuration.pageId,
        actorId: configuration.actorId,
        updateBase64: encodeYjsUpdateBase64(update),
      });
    },
    [
      configuration.actorId,
      configuration.pageId,
      configuration.roomId,
      emitMessage,
    ],
  );

  const handleRemoteFinalStrokesChange = useCallback((strokes: Stroke[]) => {
    setRemoteStrokes((previous) =>
      previous.filter(
        (stroke) =>
          !strokes.some((finalStroke) => finalStroke.id === stroke.id),
      ),
    );
  }, []);

  const handleRemoteObjectsChange = useCallback((objects: WebGLObject[]) => {
    setRemoteObjects(objects);
  }, []);

  const {
    yjsStrokes,
    yjsObjects,
    yjsDebug,
    applyRemoteUpdate,
    commitStroke,
    deleteStrokes,
    commitObjects: commitYjsObjects,
    deleteObjects,
    encodeCurrentState,
    markSyncRequested,
    markSyncResponded,
  } = useRealtimeInkDocument({
    configuration,
    enabled: configuration.enabled,
    onLocalUpdate: handleLocalYjsUpdate,
    onRemoteFinalStrokesChange: handleRemoteFinalStrokesChange,
    onRemoteObjectsChange: handleRemoteObjectsChange,
  });

  const commitObjects = useCallback(
    (objects: WebGLObject[]) => {
      if (!configuration.enabled) {
        commitYjsObjects(objects);
        return;
      }

      for (const object of objects) {
        const asset = getImageAssetReference(object);
        if (!asset) continue;

        emitMessage("server-broadcast", {
          protocol: protocolName,
          version: 1,
          type: "image:ready",
          roomId: configuration.roomId,
          pageId: configuration.pageId,
          actorId: configuration.actorId,
          actorRole: configuration.actorRole,
          object: toRealtimeImageObject(object),
          asset,
        });
      }

      commitYjsObjects(objects);
    },
    [
      commitYjsObjects,
      configuration.actorId,
      configuration.actorRole,
      configuration.enabled,
      configuration.pageId,
      configuration.roomId,
      emitMessage,
    ],
  );

  const broadcastImagePreview = useCallback(
    (object: WebGLObject, previewDataUrl: string, previewFile: File) => {
      if (!configuration.enabled || object.kind !== "image") return;

      emitMessage("server-broadcast", {
        protocol: protocolName,
        version: 1,
        type: "image:preview",
        roomId: configuration.roomId,
        pageId: configuration.pageId,
        actorId: configuration.actorId,
        actorRole: configuration.actorRole,
        object: toRealtimeImageObject({
          ...object,
          imageStatus: "preview",
          imageMimeType: previewFile.type || object.imageMimeType,
          imageSizeBytes: previewFile.size,
        }),
        previewDataUrl,
        previewBytes: previewFile.size,
        mimeType: previewFile.type || object.imageMimeType,
      });
    },
    [
      configuration.actorId,
      configuration.actorRole,
      configuration.enabled,
      configuration.pageId,
      configuration.roomId,
      emitMessage,
    ],
  );

  const flushPendingPoints = useCallback(() => {
    if (flushTimerReference.current !== undefined) {
      window.clearTimeout(flushTimerReference.current);
      flushTimerReference.current = undefined;
    }

    const activeStroke = activeStrokeReference.current;
    if (!activeStroke || pendingPointsReference.current.length === 0) return;

    const points = pendingPointsReference.current;
    pendingPointsReference.current = [];
    activeStroke.seq += 1;

    emitMessage("server-volatile-broadcast", {
      protocol: protocolName,
      version: 1,
      type: "ink:stroke:append",
      roomId: configuration.roomId,
      pageId: configuration.pageId,
      actorId: configuration.actorId,
      actorRole: configuration.actorRole,
      strokeId: activeStroke.id,
      seq: activeStroke.seq,
      color: activeStroke.color,
      size: activeStroke.size,
      layer: activeStroke.layer,
      points,
    });
  }, [
    configuration.actorId,
    configuration.actorRole,
    configuration.pageId,
    configuration.roomId,
    emitMessage,
  ]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerReference.current !== undefined) return;
    flushTimerReference.current = window.setTimeout(
      flushPendingPoints,
      batchIntervalMs,
    );
  }, [flushPendingPoints]);

  const requestYjsSync = useCallback(() => {
    if (!configuration.enabled) return;

    emitMessage("server-broadcast", {
      protocol: protocolName,
      version: 1,
      type: "yjs:sync-request",
      roomId: configuration.roomId,
      pageId: configuration.pageId,
      actorId: configuration.actorId,
      requestId: makeRealtimeId("sync_request"),
    });

    markSyncRequested();
  }, [
    configuration.actorId,
    configuration.enabled,
    configuration.pageId,
    configuration.roomId,
    emitMessage,
    markSyncRequested,
  ]);

  useEffect(() => {
    if (!configuration.enabled) return undefined;
    if (!configuration.token) {
      setStatus("error");
      return undefined;
    }

    const socket = io(configuration.serverUrl, {
      path: socketPath,
      transports: ["websocket"],
      query: {
        token: configuration.token,
      },
      forceNew: true,
      reconnection: true,
    });

    socketReference.current = socket;
    receiveDiagnosticsReference.current = createReceiveDiagnostics();
    window.__realtimeInkReceiveDiagnostics =
      receiveDiagnosticsReference.current;

    socket.on("connect", () => {
      // 4-4: 재연결이라면 duration 기록
      if (reconnectBeginTimeReference.current !== undefined) {
        reconnectCountReference.current += 1;
        const reconnectDurationMs = Math.round(
          performance.now() - reconnectBeginTimeReference.current,
        );
        const reconnectSpan = startFrontendSpan("client.socket.reconnect", {
          "messaging.system": "socket.io",
          "room.id": configuration.roomId,
          "realtime.actor.id": configuration.actorId,
          "realtime.actor.role": configuration.actorRole,
          "reconnect.duration_ms": reconnectDurationMs,
          "reconnect.count": reconnectCountReference.current,
        });
        reconnectSpan.end();
        reconnectBeginTimeReference.current = undefined;
      }

      const connectSpan = startFrontendSpan("client.socket.connect", {
        "messaging.system": "socket.io",
        "socket.id": socket.id,
        "socket.transport": socket.io.engine.transport.name,
        "room.id": configuration.roomId,
        "realtime.actor.id": configuration.actorId,
        "realtime.actor.role": configuration.actorRole,
      });
      connectSpan.end();

      setStatus("connected");
      const joinSpan = startFrontendSpan("client.socket.join-room", {
        "messaging.system": "socket.io",
        "messaging.destination.name": configuration.roomId,
        "socket.event": "join-room",
        "socket.id": socket.id,
        "socket.transport": socket.io.engine.transport.name,
        "room.id": configuration.roomId,
        "realtime.actor.id": configuration.actorId,
        "realtime.actor.role": configuration.actorRole,
      });
      const traceCarrier = makeTraceCarrier(joinSpan);
      joinSpan.setAttribute("traceparent", traceCarrier.traceparent ?? "");
      try {
        socket.emit("join-room", configuration.roomId, traceCarrier);
      } catch (error) {
        recordSpanError(joinSpan, error);
        throw error;
      } finally {
        joinSpan.end();
      }

      // 4-3: cold start span 시작 (첫 client-broadcast 수신 시 종료)
      if (!coldStartSpanReference.current) {
        const coldStartSpan = startFrontendSpan("client.realtime.cold-start", {
          "room.id": configuration.roomId,
          "realtime.actor.id": configuration.actorId,
          "realtime.actor.role": configuration.actorRole,
        });
        coldStartSpanReference.current = coldStartSpan;
        coldStartBeginTimeReference.current = performance.now();
      }

      if (syncRequestTimerReference.current !== undefined) {
        window.clearTimeout(syncRequestTimerReference.current);
      }
      syncRequestTimerReference.current = window.setTimeout(() => {
        syncRequestTimerReference.current = undefined;
        requestYjsSync();
      }, syncRequestDelayMs);
    });

    socket.on("disconnect", (reason) => {
      const span = startFrontendSpan("client.socket.disconnect", {
        "messaging.system": "socket.io",
        "socket.event": "disconnect",
        "socket.disconnect.reason": reason,
        "socket.id": socket.id,
        "room.id": configuration.roomId,
        "realtime.actor.id": configuration.actorId,
        "realtime.actor.role": configuration.actorRole,
      });
      span.end();
      // 4-4: 재연결 시작 시각 기록
      reconnectBeginTimeReference.current = performance.now();
      setStatus("disconnected");
    });

    socket.on("connect_error", (error) => {
      const span = startFrontendSpan("client.socket.connect-error", {
        "messaging.system": "socket.io",
        "socket.event": "connect_error",
        "room.id": configuration.roomId,
        "realtime.actor.id": configuration.actorId,
        "realtime.actor.role": configuration.actorRole,
      });
      recordSpanError(span, error);
      span.end();
      setStatus("error");
    });

    socket.on(
      "client-broadcast",
      (
        data: unknown,
        maybeIvOrTraceCarrier?: Uint8Array | TraceCarrier,
        maybeTraceCarrier?: TraceCarrier,
      ) => {
        const handlerStartedAt = performance.now();
        const diagnostics = receiveDiagnosticsReference.current;
        diagnostics.received += 1;
        diagnostics.lastMessageAt = new Date().toISOString();
        const traceCarrier =
          maybeTraceCarrier ??
          (isTraceCarrier(maybeIvOrTraceCarrier)
            ? maybeIvOrTraceCarrier
            : undefined);
        const message = decodeMessage(data);
        const messageType = message?.type ?? "invalid";
        diagnostics.byType[messageType] =
          (diagnostics.byType[messageType] ?? 0) + 1;
        const spanKey = `${configuration.actorId}:${traceCarrier?.traceparent ?? ""}:${
          messageType
        }:${message && "strokeId" in message ? message.strokeId : ""}:${
          message && "seq" in message ? message.seq : ""
        }`;
        const sampled = shouldSampleTrace(
          configuration.receiveTraceSampleRate,
          spanKey,
        );
        const span = sampled
          ? startFrontendSpanFromCarrier(
              "client.socket.client-broadcast",
              {
                "messaging.system": "socket.io",
                "socket.event": "client-broadcast",
                "socket.id": socket.id,
                "socket.transport": socket.io.engine.transport.name,
                "room.id": configuration.roomId,
                "realtime.actor.id": configuration.actorId,
                "realtime.actor.role": configuration.actorRole,
                "payload.bytes": getPayloadBytes(data),
                "server.traceparent": traceCarrier?.traceparent,
                "trace.sample_rate": configuration.receiveTraceSampleRate,
              },
              traceCarrier,
            )
          : undefined;

        try {
          if (!isRealtimeInkMessage(message)) {
            diagnostics.invalid += 1;
            span?.setAttribute("realtime.message.valid", false);
            return;
          }
          span?.setAttributes({
            "realtime.message.valid": true,
            "realtime.message.type": message.type,
            "realtime.message.actor.id": message.actorId,
            "realtime.message.room.id": message.roomId,
            "realtime.message.page.id": message.pageId,
            // 4-2: sender/receiver 명시적 식별
            "stroke.sender.id": message.actorId,
            "stroke.receiver.id": configuration.actorId,
            "stroke.receiver.role": configuration.actorRole,
            ...("strokeId" in message && message.strokeId
              ? { "stroke.id": message.strokeId }
              : {}),
          });

          // 4-3: cold start 측정 — 첫 유효 메시지 수신 시 종료
          const coldStartSpan = coldStartSpanReference.current;
          if (
            coldStartSpan &&
            coldStartBeginTimeReference.current !== undefined
          ) {
            const coldStartDurationMs = Math.round(
              performance.now() - coldStartBeginTimeReference.current,
            );
            coldStartSpan.setAttributes({
              "cold_start.duration_ms": coldStartDurationMs,
              "cold_start.first_message.type": message.type,
              "cold_start.first_message.sender.id": message.actorId,
            });
            coldStartSpan.end();
            coldStartSpanReference.current = undefined;
            coldStartBeginTimeReference.current = undefined;
          }
          if (message.roomId !== configuration.roomId) {
            diagnostics.ignored += 1;
            return;
          }
          if (message.pageId !== configuration.pageId) {
            diagnostics.ignored += 1;
            return;
          }
          if (message.actorId === configuration.actorId) {
            diagnostics.ignored += 1;
            return;
          }

          diagnostics.applied += 1;
          diagnostics.lastAppliedAt = new Date().toISOString();
          diagnostics.appliedByType[message.type] =
            (diagnostics.appliedByType[message.type] ?? 0) + 1;

          if (message.type === "yjs:sync-request") {
            emitMessage("server-broadcast", {
              protocol: protocolName,
              version: 1,
              type: "yjs:sync-response",
              roomId: configuration.roomId,
              pageId: configuration.pageId,
              actorId: configuration.actorId,
              targetActorId: message.actorId,
              requestId: message.requestId,
              updateBase64: encodeYjsUpdateBase64(encodeCurrentState()),
            });

            markSyncResponded();
            return;
          }

          if (message.type === "yjs:sync-response") {
            if (message.targetActorId !== configuration.actorId) return;
            // 4-6: Yjs sync 완료 span
            const yjsSyncSpan = startFrontendSpan("client.yjs.sync", {
              "yjs.sync.completed": true,
              "yjs.update.origin": "sync-response",
              "yjs.sender.id": message.actorId,
              "room.id": configuration.roomId,
              "realtime.actor.id": configuration.actorId,
            });
            const update = decodeYjsUpdateBytes(message);
            if (update) applyRemoteUpdate(update, { sync: true });
            yjsSyncSpan.end();
            return;
          }

          if (message.type === "yjs:update") {
            // 4-6: Yjs 원격 업데이트 span
            const yjsUpdateSpan = startFrontendSpan("client.yjs.update", {
              "yjs.update.origin": "remote",
              "yjs.sender.id": message.actorId,
              "room.id": configuration.roomId,
              "realtime.actor.id": configuration.actorId,
            });
            const update = decodeYjsUpdateBytes(message);
            if (update) applyRemoteUpdate(update);
            yjsUpdateSpan.end();
            return;
          }

          if (message.type === "image:ready") {
            const asset: CollaborativeAsset = {
              ...message.asset,
              pageId: message.pageId,
              actorId: message.actorId,
              actorRole: message.actorRole,
              updatedAt: Date.now(),
            };
            const object = hydrateImageObject(message.object, asset);
            setRemoteObjects((previous) => [
              ...previous.filter((item) => item.id !== object.id),
              object,
            ]);
            return;
          }

          if (message.type === "image:preview") {
            const object: WebGLObject = {
              ...message.object,
              imageSrc: message.previewDataUrl,
              imageMimeType: message.mimeType,
              imageSizeBytes: message.previewBytes,
              imageStatus: "preview",
            };
            setRemoteObjects((previous) => {
              const existing = previous.find((item) => item.id === object.id);
              if (
                existing?.kind === "image" &&
                (existing.imageStatus === "uploaded" || existing.imageUrl)
              ) {
                return previous;
              }

              return [
                ...previous.filter((item) => item.id !== object.id),
                object,
              ];
            });
            return;
          }

          if (message.type === "ink:stroke:start") {
            const point = normalizeStrokePoint(message.point);
            setRemoteStrokes((previous) => [
              ...previous.filter((stroke) => stroke.id !== message.strokeId),
              {
                id: message.strokeId,
                kind: "stroke",
                points: [point],
                color: message.color,
                size: message.size,
                layer: message.layer,
              },
            ]);
            return;
          }

          if (message.type === "ink:stroke:append") {
            const points = normalizeStrokePoints(message.points);
            setRemoteStrokes((previous) => {
              const existing = previous.find(
                (stroke) => stroke.id === message.strokeId,
              );
              if (!existing) {
                return [
                  ...previous,
                  {
                    id: message.strokeId,
                    kind: "stroke",
                    points: getNextStrokePointBatch([], points),
                    color: message.color,
                    size: message.size,
                    layer: message.layer,
                  },
                ];
              }
              return previous.map((stroke) =>
                stroke.id === message.strokeId
                  ? {
                      ...stroke,
                      points: getNextStrokePointBatch(
                        stroke.points,
                        points,
                      ),
                    }
                  : stroke,
              );
            });
            return;
          }

          if (message.type === "ink:stroke:end") {
            const points = normalizeStrokePoints(message.points);
            setRemoteStrokes((previous) =>
              previous.map((stroke) =>
                stroke.id === message.strokeId
                  ? {
                      ...stroke,
                      points,
                    }
                  : stroke,
              ),
            );
          }
        } catch (error) {
          diagnostics.errors += 1;
          diagnostics.lastError =
            error instanceof Error ? error.message : String(error);
          if (span) recordSpanError(span, error);
          throw error;
        } finally {
          recordHandlerDuration(
            diagnostics,
            performance.now() - handlerStartedAt,
          );
          span?.end();
        }
      },
    );

    return () => {
      if (syncRequestTimerReference.current !== undefined) {
        window.clearTimeout(syncRequestTimerReference.current);
        syncRequestTimerReference.current = undefined;
      }
      socket.removeAllListeners();
      socket.disconnect();
      socketReference.current = undefined;
      if (
        window.__realtimeInkReceiveDiagnostics ===
        receiveDiagnosticsReference.current
      ) {
        delete window.__realtimeInkReceiveDiagnostics;
      }
    };
  }, [
    applyRemoteUpdate,
    configuration,
    emitMessage,
    encodeCurrentState,
    markSyncResponded,
    requestYjsSync,
  ]);

  useEffect(
    () => () => {
      if (flushTimerReference.current !== undefined) {
        window.clearTimeout(flushTimerReference.current);
      }
    },
    [],
  );

  const beginStroke = useCallback(
    (point: Point2D, style: StrokeStyle, strokeId?: string) => {
      if (!configuration.enabled) return;

      const normalizedPoint = normalizeStrokePoint(point);
      const nextStrokeId = strokeId ?? makeRealtimeId("remote_stroke");
      const layer = style.layer ?? defaultRemoteLayer;
      activeStrokeReference.current = {
        id: nextStrokeId,
        seq: 0,
        color: style.color,
        size: style.size,
        layer,
        points: [normalizedPoint],
      };
      pendingPointsReference.current = [];

      // stroke lifecycle span — endStroke에서 완료 여부 기록
      const strokeSpan = startFrontendSpan("client.realtime.stroke", {
        "stroke.id": nextStrokeId,
        "stroke.actor.id": configuration.actorId,
        "stroke.actor.role": configuration.actorRole,
        "stroke.room.id": configuration.roomId,
        "stroke.page.id": configuration.pageId,
        "stroke.completed": false,
      });
      strokeSpan.addEvent("stroke.begin", {
        "stroke.id": nextStrokeId,
        "stroke.color": style.color,
        "stroke.size": style.size,
      });
      activeStrokeSpanReference.current = strokeSpan;
      strokeBeginTimeReference.current = performance.now();

      emitMessage("server-broadcast", {
        protocol: protocolName,
        version: 1,
        type: "ink:stroke:start",
        roomId: configuration.roomId,
        pageId: configuration.pageId,
        actorId: configuration.actorId,
        actorRole: configuration.actorRole,
        strokeId: nextStrokeId,
        color: style.color,
        size: style.size,
        layer,
        point: normalizedPoint,
      });
    },
    [configuration, emitMessage],
  );

  const appendStrokePoints = useCallback(
    (pointOrPoints: Point2D | Point2D[]) => {
      const activeStroke = activeStrokeReference.current;
      if (!configuration.enabled || !activeStroke) return;

      const points = normalizeStrokePoints(
        Array.isArray(pointOrPoints) ? pointOrPoints : [pointOrPoints],
      );
      if (points.length === 0) return;

      const nextPoints = getNextStrokePointBatch(activeStroke.points, points);
      if (nextPoints === activeStroke.points) return;

      const appendedPoints = nextPoints.slice(activeStroke.points.length);
      activeStroke.points = nextPoints;
      pendingPointsReference.current.push(...appendedPoints);
      scheduleFlush();
    },
    [configuration.enabled, scheduleFlush],
  );

  const endStroke = useCallback(() => {
    const activeStroke = activeStrokeReference.current;
    if (!configuration.enabled || !activeStroke) return;

    flushPendingPoints();
    emitMessage("server-broadcast", {
      protocol: protocolName,
      version: 1,
      type: "ink:stroke:end",
      roomId: configuration.roomId,
      pageId: configuration.pageId,
      actorId: configuration.actorId,
      actorRole: configuration.actorRole,
      strokeId: activeStroke.id,
      points: activeStroke.points,
    });

    commitStroke(activeStroke);

    // stroke lifecycle span 완료 기록
    const strokeSpan = activeStrokeSpanReference.current;
    if (strokeSpan) {
      const durationMs =
        strokeBeginTimeReference.current !== undefined
          ? Math.round(performance.now() - strokeBeginTimeReference.current)
          : undefined;
      strokeSpan.addEvent("stroke.end", {
        "stroke.id": activeStroke.id,
        "stroke.points.count": activeStroke.points.length,
        ...(durationMs !== undefined && { "stroke.duration_ms": durationMs }),
      });
      strokeSpan.setAttribute("stroke.completed", true);
      strokeSpan.setAttribute(
        "stroke.points.count",
        activeStroke.points.length,
      );
      strokeSpan.end();
      activeStrokeSpanReference.current = undefined;
      strokeBeginTimeReference.current = undefined;
    }

    activeStrokeReference.current = undefined;
  }, [
    configuration.actorId,
    configuration.actorRole,
    configuration.enabled,
    configuration.pageId,
    configuration.roomId,
    emitMessage,
    flushPendingPoints,
    commitStroke,
  ]);

  const remoteFinalStrokes = useMemo(
    () =>
      yjsStrokes.filter((stroke) => stroke.actorId !== configuration.actorId),
    [configuration.actorId, yjsStrokes],
  );

  return {
    ...configuration,
    status,
    sharedStrokes: yjsStrokes,
    sharedObjects: yjsObjects,
    remoteStrokes,
    remoteFinalStrokes,
    remoteObjects,
    yjsDebug,
    beginStroke,
    appendStrokePoints,
    endStroke,
    commitStroke,
    deleteStrokes,
    commitObjects,
    broadcastImagePreview,
    deleteObjects,
  };
}

export default useRealtimeInk;
