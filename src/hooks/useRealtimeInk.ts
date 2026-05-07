import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import * as Y from "yjs";
import type { Point2D, Stroke } from "../types/editor";

type RealtimeInkStatus =
  | "disabled"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

type RealtimeInkRole = "teacher" | "student";

type RealtimeInkConfiguration = {
  enabled: boolean;
  serverUrl: string;
  roomId: string;
  pageId: string;
  token: string;
  actorId: string;
  actorRole: RealtimeInkRole;
};

type StrokeStyle = {
  color: string;
  size: number;
  layer?: number;
};

type CollaborativeStroke = Stroke & {
  pageId: string;
  actorId: string;
  actorRole: RealtimeInkRole;
  createdAt: number;
};

type RealtimeInkYjsDebug = {
  strokeCount: number;
  remoteStrokeCount: number;
  localUpdateCount: number;
  remoteUpdateCount: number;
  sentUpdateCount: number;
  appliedUpdateCount: number;
  lastLocalUpdateAt: number | undefined;
  lastRemoteUpdateAt: number | undefined;
};

type RealtimeInkMessage =
  | {
      protocol: "pentest-ink";
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
      protocol: "pentest-ink";
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
      protocol: "pentest-ink";
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
      protocol: "pentest-ink";
      version: 1;
      type: "yjs:update";
      roomId: string;
      pageId: string;
      actorId: string;
      update: number[];
    };

const protocolName = "pentest-ink";
const socketPath = "/handwriting/socket.io/";
const batchIntervalMs = 50;
const defaultInkServerUrl = "http://localhost:3000";
const defaultRoomId = "pentest-ink-local-room";
const defaultPageId = "page-1";
const defaultRole: RealtimeInkRole = "student";
const defaultRemoteLayer = 50;
const localYjsOrigin = "pentest-ink-local-yjs";
const remoteYjsOrigin = "pentest-ink-remote-yjs";

const initialYjsDebug: RealtimeInkYjsDebug = {
  strokeCount: 0,
  remoteStrokeCount: 0,
  localUpdateCount: 0,
  remoteUpdateCount: 0,
  sentUpdateCount: 0,
  appliedUpdateCount: 0,
  lastLocalUpdateAt: undefined,
  lastRemoteUpdateAt: undefined,
};

function makeRealtimeId(prefix: string): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (randomUUID) return `${prefix}_${randomUUID.call(globalThis.crypto)}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}`;
}

function getOrCreateSessionActorId(): string {
  const key = "pentest-ink-actor-id";
  const stored = globalThis.sessionStorage?.getItem(key);
  if (stored) return stored;
  const next = makeRealtimeId("actor");
  globalThis.sessionStorage?.setItem(key, next);
  return next;
}

function readConfiguration(): RealtimeInkConfiguration {
  const parameters = new URLSearchParams(globalThis.location.search);
  const enabled =
    parameters.get("realtimeInk") === "1" ||
    parameters.get("realtimeInk") === "true";
  const actorRole =
    parameters.get("inkRole") === "teacher" ? "teacher" : defaultRole;

  return {
    enabled,
    serverUrl: parameters.get("inkServer") ?? defaultInkServerUrl,
    roomId: parameters.get("inkRoom") ?? defaultRoomId,
    pageId: parameters.get("inkPage") ?? defaultPageId,
    token: parameters.get("inkToken") ?? "",
    actorId: parameters.get("inkActor") ?? getOrCreateSessionActorId(),
    actorRole,
  };
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

function encodeMessage(message: RealtimeInkMessage): ArrayBuffer {
  return toExactArrayBuffer(new TextEncoder().encode(JSON.stringify(message)));
}

function decodeMessage(data: unknown): RealtimeInkMessage | undefined {
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

function isRealtimeInkMessage(
  message: RealtimeInkMessage | undefined,
): message is RealtimeInkMessage {
  return message?.protocol === protocolName && message.version === 1;
}

function appendUniquePoints(
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

export function useRealtimeInk() {
  const configuration = useMemo(readConfiguration, []);
  const socketReference = useRef<Socket | undefined>();
  const ydocReference = useRef<Y.Doc | undefined>();
  const yStrokesReference = useRef<Y.Map<CollaborativeStroke> | undefined>();
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
  const [status, setStatus] = useState<RealtimeInkStatus>(
    configuration.enabled ? "connecting" : "disabled",
  );
  const [remoteStrokes, setRemoteStrokes] = useState<Stroke[]>([]);
  const [yjsStrokes, setYjsStrokes] = useState<CollaborativeStroke[]>([]);
  const [yjsDebug, setYjsDebug] =
    useState<RealtimeInkYjsDebug>(initialYjsDebug);

  const refreshYjsStrokes = useCallback(() => {
    const yStrokes = yStrokesReference.current;
    if (!yStrokes) return;

    const nextStrokes = Array.from(yStrokes.values()).filter(
      (stroke) => stroke.pageId === configuration.pageId,
    );
    const remoteFinalStrokes = nextStrokes.filter(
      (stroke) => stroke.actorId !== configuration.actorId,
    );

    setYjsStrokes(nextStrokes);
    setYjsDebug((previous) => ({
      ...previous,
      strokeCount: nextStrokes.length,
      remoteStrokeCount: remoteFinalStrokes.length,
    }));
    setRemoteStrokes((previous) =>
      previous.filter(
        (stroke) =>
          !remoteFinalStrokes.some((finalStroke) => finalStroke.id === stroke.id),
      ),
    );
  }, [configuration.actorId, configuration.pageId]);

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

  useEffect(() => {
    if (!configuration.enabled) return undefined;

    const ydoc = new Y.Doc();
    const yStrokes = ydoc.getMap<CollaborativeStroke>("strokes");
    ydocReference.current = ydoc;
    yStrokesReference.current = yStrokes;

    const handleYjsUpdate = (update: Uint8Array, origin: unknown): void => {
      if (origin === remoteYjsOrigin) return;

      setYjsDebug((previous) => ({
        ...previous,
        localUpdateCount: previous.localUpdateCount + 1,
        sentUpdateCount: previous.sentUpdateCount + 1,
        lastLocalUpdateAt: Date.now(),
      }));

      emitMessage("server-broadcast", {
        protocol: protocolName,
        version: 1,
        type: "yjs:update",
        roomId: configuration.roomId,
        pageId: configuration.pageId,
        actorId: configuration.actorId,
        update: Array.from(update),
      });
    };

    ydoc.on("update", handleYjsUpdate);
    yStrokes.observe(refreshYjsStrokes);
    refreshYjsStrokes();

    return () => {
      yStrokes.unobserve(refreshYjsStrokes);
      ydoc.off("update", handleYjsUpdate);
      ydoc.destroy();
      ydocReference.current = undefined;
      yStrokesReference.current = undefined;
      setYjsStrokes([]);
      setYjsDebug(initialYjsDebug);
    };
  }, [configuration, emitMessage, refreshYjsStrokes]);

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

      if (message.type === "yjs:update") {
        const ydoc = ydocReference.current;
        if (!ydoc) return;

        Y.applyUpdate(ydoc, new Uint8Array(message.update), remoteYjsOrigin);
        setYjsDebug((previous) => ({
          ...previous,
          remoteUpdateCount: previous.remoteUpdateCount + 1,
          appliedUpdateCount: previous.appliedUpdateCount + 1,
          lastRemoteUpdateAt: Date.now(),
        }));
        refreshYjsStrokes();
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
      socket.removeAllListeners();
      socket.disconnect();
      socketReference.current = undefined;
    };
  }, [configuration]);

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

    const ydoc = ydocReference.current;
    const yStrokes = yStrokesReference.current;
    if (ydoc && yStrokes) {
      ydoc.transact(() => {
        yStrokes.set(activeStroke.id, {
          id: activeStroke.id,
          kind: "stroke",
          points: activeStroke.points,
          color: activeStroke.color,
          size: activeStroke.size,
          layer: activeStroke.layer,
          pageId: configuration.pageId,
          actorId: configuration.actorId,
          actorRole: configuration.actorRole,
          createdAt: Date.now(),
        });
      }, localYjsOrigin);
      refreshYjsStrokes();
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
    refreshYjsStrokes,
  ]);

  const remoteFinalStrokes = useMemo(
    () =>
      yjsStrokes.filter((stroke) => stroke.actorId !== configuration.actorId),
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
