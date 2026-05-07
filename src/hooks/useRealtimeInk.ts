import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { Point2D, Stroke } from "../types/editor";
import useRealtimeInkDocument from "./useRealtimeInkDocument";
import {
  appendUniquePoints,
  batchIntervalMs,
  decodeMessage,
  defaultRemoteLayer,
  encodeMessage,
  isRealtimeInkMessage,
  makeRealtimeId,
  protocolName,
  readRealtimeInkConfiguration,
  socketPath,
  syncRequestDelayMs,
  type RealtimeInkMessage,
  type RealtimeInkStatus,
  type StrokeStyle,
} from "../lib/realtimeInkProtocol";

export function useRealtimeInk() {
  const configuration = useMemo(readRealtimeInkConfiguration, []);
  const socketReference = useRef<Socket | undefined>();
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
  const [status, setStatus] = useState<RealtimeInkStatus>(
    configuration.enabled ? "connecting" : "disabled",
  );
  const [remoteStrokes, setRemoteStrokes] = useState<Stroke[]>([]);

  const emitMessage = useCallback(
    (
      eventName: "server-broadcast" | "server-volatile-broadcast",
      message: RealtimeInkMessage,
    ) => {
      const socket = socketReference.current;
      if (!socket?.connected) return;
      socket.emit(
        eventName,
        configuration.roomId,
        encodeMessage(message),
        new Uint8Array(),
      );
    },
    [configuration.roomId],
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
        update: Array.from(update),
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

  const {
    yjsStrokes,
    yjsDebug,
    applyRemoteUpdate,
    commitStroke,
    encodeCurrentState,
    markSyncRequested,
    markSyncResponded,
  } = useRealtimeInkDocument({
    configuration,
    enabled: configuration.enabled,
    onLocalUpdate: handleLocalYjsUpdate,
    onRemoteFinalStrokesChange: handleRemoteFinalStrokesChange,
  });

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

    socket.on("connect", () => {
      setStatus("connected");
      socket.emit("join-room", configuration.roomId);
      if (syncRequestTimerReference.current !== undefined) {
        window.clearTimeout(syncRequestTimerReference.current);
      }
      syncRequestTimerReference.current = window.setTimeout(() => {
        syncRequestTimerReference.current = undefined;
        requestYjsSync();
      }, syncRequestDelayMs);
    });

    socket.on("disconnect", () => {
      setStatus("disconnected");
    });

    socket.on("connect_error", () => {
      setStatus("error");
    });

    socket.on("client-broadcast", (data: unknown) => {
      const message = decodeMessage(data);
      if (!isRealtimeInkMessage(message)) return;
      if (message.roomId !== configuration.roomId) return;
      if (message.pageId !== configuration.pageId) return;
      if (message.actorId === configuration.actorId) return;

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
          update: encodeCurrentState(),
        });

        markSyncResponded();
        return;
      }

      if (message.type === "yjs:sync-response") {
        if (message.targetActorId !== configuration.actorId) return;
        applyRemoteUpdate(message.update, { sync: true });
        return;
      }

      if (message.type === "yjs:update") {
        applyRemoteUpdate(message.update);
        return;
      }

      if (message.type === "ink:stroke:start") {
        setRemoteStrokes((previous) => [
          ...previous.filter((stroke) => stroke.id !== message.strokeId),
          {
            id: message.strokeId,
            kind: "stroke",
            points: [message.point],
            color: message.color,
            size: message.size,
            layer: message.layer,
          },
        ]);
        return;
      }

      if (message.type === "ink:stroke:append") {
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
                points: message.points,
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
                  points: appendUniquePoints(stroke.points, message.points),
                }
              : stroke,
          );
        });
        return;
      }

      if (message.type === "ink:stroke:end") {
        setRemoteStrokes((previous) =>
          previous.map((stroke) =>
            stroke.id === message.strokeId
              ? { ...stroke, points: message.points }
              : stroke,
          ),
        );
      }
    });

    return () => {
      if (syncRequestTimerReference.current !== undefined) {
        window.clearTimeout(syncRequestTimerReference.current);
        syncRequestTimerReference.current = undefined;
      }
      socket.removeAllListeners();
      socket.disconnect();
      socketReference.current = undefined;
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
    (point: Point2D, style: StrokeStyle) => {
      if (!configuration.enabled) return;

      const strokeId = makeRealtimeId("remote_stroke");
      const layer = style.layer ?? defaultRemoteLayer;
      activeStrokeReference.current = {
        id: strokeId,
        seq: 0,
        color: style.color,
        size: style.size,
        layer,
        points: [point],
      };
      pendingPointsReference.current = [];

      emitMessage("server-broadcast", {
        protocol: protocolName,
        version: 1,
        type: "ink:stroke:start",
        roomId: configuration.roomId,
        pageId: configuration.pageId,
        actorId: configuration.actorId,
        actorRole: configuration.actorRole,
        strokeId,
        color: style.color,
        size: style.size,
        layer,
        point,
      });
    },
    [configuration, emitMessage],
  );

  const appendStrokePoints = useCallback(
    (pointOrPoints: Point2D | Point2D[]) => {
      const activeStroke = activeStrokeReference.current;
      if (!configuration.enabled || !activeStroke) return;

      const points = Array.isArray(pointOrPoints)
        ? pointOrPoints
        : [pointOrPoints];
      if (points.length === 0) return;

      activeStroke.points = appendUniquePoints(activeStroke.points, points);
      pendingPointsReference.current = [
        ...pendingPointsReference.current,
        ...points,
      ];
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
      yjsStrokes.filter(
        (stroke) => stroke.actorId !== configuration.actorId,
      ),
    [configuration.actorId, yjsStrokes],
  );

  return {
    ...configuration,
    status,
    remoteStrokes,
    remoteFinalStrokes,
    yjsDebug,
    beginStroke,
    appendStrokePoints,
    endStroke,
  };
}

export default useRealtimeInk;
