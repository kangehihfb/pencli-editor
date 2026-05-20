import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import type { Point2D, Stroke, WebGLObject } from "../types/editor";
import {
  getImageAssetReference,
  hydrateImageObject,
  toRealtimeImageObject,
} from "../lib/imageAssets";
import {
  initialYjsDebug,
  localYjsOrigin,
  normalizeStrokePoints,
  remoteYjsOrigin,
  type CollaborativeAsset,
  type CollaborativeObject,
  type CollaborativeStroke,
  type RealtimeInkConfiguration,
  type RealtimeInkYjsDebug,
} from "../lib/realtimeInkProtocol";

type CommitStrokeInput = {
  id: string;
  color: string;
  size: number;
  layer: number;
  rotation?: number;
  points: Point2D[];
};

type UseRealtimeInkDocumentInput = {
  configuration: RealtimeInkConfiguration;
  enabled: boolean;
  onLocalUpdate: (update: Uint8Array) => void;
  onRemoteFinalStrokesChange: (strokes: CollaborativeStroke[]) => void;
  onRemoteObjectsChange: (objects: CollaborativeObject[]) => void;
};

export function useRealtimeInkDocument(input: UseRealtimeInkDocumentInput) {
  const {
    configuration,
    enabled,
    onLocalUpdate,
    onRemoteFinalStrokesChange,
    onRemoteObjectsChange,
  } = input;
  const ydocReference = useRef<Y.Doc | undefined>();
  const yStrokesReference = useRef<Y.Map<CollaborativeStroke> | undefined>();
  const yObjectsReference = useRef<Y.Map<CollaborativeObject> | undefined>();
  const yAssetsReference = useRef<Y.Map<CollaborativeAsset> | undefined>();
  const [yjsStrokes, setYjsStrokes] = useState<CollaborativeStroke[]>([]);
  const [yjsObjects, setYjsObjects] = useState<CollaborativeObject[]>([]);
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
    onRemoteFinalStrokesChange(remoteFinalStrokes);
  }, [configuration.actorId, configuration.pageId, onRemoteFinalStrokesChange]);

  const refreshYjsObjects = useCallback(() => {
    const yObjects = yObjectsReference.current;
    const yAssets = yAssetsReference.current;
    if (!yObjects) return;

    const assetsByFileId = new Map(
      Array.from(yAssets?.values() ?? [])
        .filter((asset) => asset.pageId === configuration.pageId)
        .map((asset) => [asset.fileId, asset]),
    );
    const nextObjects = Array.from(yObjects.values())
      .filter((object) => object.pageId === configuration.pageId)
      .map((object) => {
        if (object.kind !== "image" || !object.imageFileId) return object;
        return hydrateImageObject(
          object,
          assetsByFileId.get(object.imageFileId),
        ) as CollaborativeObject;
      });
    const remoteObjects = nextObjects.filter(
      (object) => object.actorId !== configuration.actorId,
    );

    setYjsObjects(nextObjects);
    setYjsDebug((previous) => ({
      ...previous,
      objectCount: nextObjects.length,
      remoteObjectCount: remoteObjects.length,
      assetCount: assetsByFileId.size,
    }));
    onRemoteObjectsChange(remoteObjects);
  }, [configuration.actorId, configuration.pageId, onRemoteObjectsChange]);

  useEffect(() => {
    if (!enabled) return undefined;

    const ydoc = new Y.Doc();
    const yStrokes = ydoc.getMap<CollaborativeStroke>("strokes");
    const yObjects = ydoc.getMap<CollaborativeObject>("objects");
    const yAssets = ydoc.getMap<CollaborativeAsset>("assets");
    ydocReference.current = ydoc;
    yStrokesReference.current = yStrokes;
    yObjectsReference.current = yObjects;
    yAssetsReference.current = yAssets;

    const handleYjsUpdate = (update: Uint8Array, origin: unknown): void => {
      if (origin === remoteYjsOrigin) return;

      setYjsDebug((previous) => ({
        ...previous,
        localUpdateCount: previous.localUpdateCount + 1,
        sentUpdateCount: previous.sentUpdateCount + 1,
        lastLocalUpdateAt: Date.now(),
      }));
      onLocalUpdate(update);
    };

    ydoc.on("update", handleYjsUpdate);
    yStrokes.observe(refreshYjsStrokes);
    yObjects.observe(refreshYjsObjects);
    yAssets.observe(refreshYjsObjects);
    refreshYjsStrokes();
    refreshYjsObjects();

    return () => {
      yStrokes.unobserve(refreshYjsStrokes);
      yObjects.unobserve(refreshYjsObjects);
      yAssets.unobserve(refreshYjsObjects);
      ydoc.off("update", handleYjsUpdate);
      ydoc.destroy();
      ydocReference.current = undefined;
      yStrokesReference.current = undefined;
      yObjectsReference.current = undefined;
      yAssetsReference.current = undefined;
      setYjsStrokes([]);
      setYjsObjects([]);
      setYjsDebug(initialYjsDebug);
    };
  }, [enabled, onLocalUpdate, refreshYjsObjects, refreshYjsStrokes]);

  const applyRemoteUpdate = useCallback(
    (update: number[] | Uint8Array, options?: { sync?: boolean }) => {
      const ydoc = ydocReference.current;
      if (!ydoc) return;

      Y.applyUpdate(
        ydoc,
        update instanceof Uint8Array ? update : new Uint8Array(update),
        remoteYjsOrigin,
      );
      setYjsDebug((previous) => ({
        ...previous,
        remoteUpdateCount: previous.remoteUpdateCount + 1,
        appliedUpdateCount: previous.appliedUpdateCount + 1,
        syncAppliedCount: options?.sync
          ? previous.syncAppliedCount + 1
          : previous.syncAppliedCount,
        lastRemoteUpdateAt: Date.now(),
        lastSyncAt: options?.sync ? Date.now() : previous.lastSyncAt,
      }));
      refreshYjsStrokes();
      refreshYjsObjects();
    },
    [refreshYjsObjects, refreshYjsStrokes],
  );

  const commitStroke = useCallback(
    (stroke: CommitStrokeInput | Stroke) => {
      const ydoc = ydocReference.current;
      const yStrokes = yStrokesReference.current;
      if (!ydoc || !yStrokes) return;

      const points = normalizeStrokePoints(stroke.points);

      ydoc.transact(() => {
        yStrokes.set(stroke.id, {
          id: stroke.id,
          kind: "stroke",
          points,
          color: stroke.color,
          size: stroke.size,
          rotation: stroke.rotation,
          layer: stroke.layer,
          pageId: configuration.pageId,
          actorId: configuration.actorId,
          actorRole: configuration.actorRole,
          createdAt: Date.now(),
        });
      }, localYjsOrigin);
      refreshYjsStrokes();
    },
    [
      configuration.actorId,
      configuration.actorRole,
      configuration.pageId,
      refreshYjsStrokes,
    ],
  );

  const deleteStrokes = useCallback(
    (strokeIds: string[]) => {
      const ydoc = ydocReference.current;
      const yStrokes = yStrokesReference.current;
      if (!ydoc || !yStrokes || strokeIds.length === 0) return;

      ydoc.transact(() => {
        for (const strokeId of strokeIds) {
          yStrokes.delete(strokeId);
        }
      }, localYjsOrigin);
      refreshYjsStrokes();
    },
    [refreshYjsStrokes],
  );

  const commitObjects = useCallback(
    (objects: WebGLObject[]) => {
      const ydoc = ydocReference.current;
      const yObjects = yObjectsReference.current;
      const yAssets = yAssetsReference.current;
      if (!ydoc || !yObjects) return;

      ydoc.transact(() => {
        for (const object of objects) {
          const realtimeObject = toRealtimeImageObject(object);
          const imageAsset = getImageAssetReference(object);

          if (imageAsset && yAssets) {
            yAssets.set(imageAsset.fileId, {
              ...imageAsset,
              width: object.width,
              height: object.height,
              pageId: configuration.pageId,
              actorId: configuration.actorId,
              actorRole: configuration.actorRole,
              updatedAt: Date.now(),
            });
          }

          yObjects.set(object.id, {
            ...realtimeObject,
            pageId: configuration.pageId,
            actorId: configuration.actorId,
            actorRole: configuration.actorRole,
            updatedAt: Date.now(),
          });
        }
      }, localYjsOrigin);
      refreshYjsObjects();
    },
    [
      configuration.actorId,
      configuration.actorRole,
      configuration.pageId,
      refreshYjsObjects,
    ],
  );

  const deleteObjects = useCallback(
    (objectIds: string[]) => {
      const ydoc = ydocReference.current;
      const yObjects = yObjectsReference.current;
      if (!ydoc || !yObjects || objectIds.length === 0) return;

      ydoc.transact(() => {
        for (const objectId of objectIds) {
          yObjects.delete(objectId);
        }
      }, localYjsOrigin);
      refreshYjsObjects();
    },
    [refreshYjsObjects],
  );

  const encodeCurrentState = useCallback(() => {
    const ydoc = ydocReference.current;
    if (!ydoc) return new Uint8Array();
    return Y.encodeStateAsUpdate(ydoc);
  }, []);

  const markSyncRequested = useCallback(() => {
    setYjsDebug((previous) => ({
      ...previous,
      syncRequestCount: previous.syncRequestCount + 1,
      lastSyncAt: Date.now(),
    }));
  }, []);

  const markSyncResponded = useCallback(() => {
    setYjsDebug((previous) => ({
      ...previous,
      syncResponseCount: previous.syncResponseCount + 1,
      lastSyncAt: Date.now(),
    }));
  }, []);

  return {
    yjsStrokes,
    yjsObjects,
    yjsDebug,
    applyRemoteUpdate,
    commitStroke,
    deleteStrokes,
    commitObjects,
    deleteObjects,
    encodeCurrentState,
    markSyncRequested,
    markSyncResponded,
  };
}

export default useRealtimeInkDocument;
