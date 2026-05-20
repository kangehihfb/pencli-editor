import { useCallback, useMemo, useState } from "react";
import type { Stroke, WebGLObject } from "../../../types/editor";
import type { RealtimeInkRole } from "../../../lib/realtimeInkProtocol";
import {
  loadProductHandwriting,
  makeProductHandwritingKey,
  runFrameActivityInternalDataFlow,
  saveProductHandwriting,
  transformProductHandwriting,
  type ProductTraceResult,
} from "../../../lib/productTraceClient";

type ProductTracePanelProps = {
  serverUrl: string;
  roomId: string;
  pageId: string;
  actorId: string;
  actorRole: RealtimeInkRole;
  strokes: Stroke[];
  objects: WebGLObject[];
  onLoadSnapshot: (snapshot: {
    strokes: Stroke[];
    objects: WebGLObject[];
  }) => void;
};

function getStatusText(result: ProductTraceResult | undefined): string {
  if (!result) return "idle";
  return `${result.operation} ${result.status}`;
}

function getResultKey(result: ProductTraceResult | undefined): string {
  return result?.targetKey || result?.key || "-";
}

export function ProductTracePanel({
  serverUrl,
  roomId,
  pageId,
  actorId,
  actorRole,
  strokes,
  objects,
  onLoadSnapshot,
}: ProductTracePanelProps): JSX.Element {
  const defaultKey = useMemo(
    () => makeProductHandwritingKey({ roomId, pageId }),
    [pageId, roomId],
  );
  const [result, setResult] = useState<ProductTraceResult>();
  const [lastKey, setLastKey] = useState<string>(defaultKey);
  const [runningOperation, setRunningOperation] = useState<string>();

  const baseInput = useMemo(
    () => ({
      serverUrl,
      roomId,
      pageId,
      actorId,
      actorRole,
    }),
    [actorId, actorRole, pageId, roomId, serverUrl],
  );

  const runProductAction = useCallback(
    async (operation: string, action: () => Promise<ProductTraceResult>) => {
      setRunningOperation(operation);
      try {
        const nextResult = await action();
        setResult(nextResult);
        if (nextResult.key) setLastKey(nextResult.key);
        if (nextResult.targetKey) setLastKey(nextResult.targetKey);
        if (nextResult.loaded) {
          onLoadSnapshot({
            strokes: nextResult.loaded.strokes,
            objects: nextResult.loaded.objects,
          });
        }
      } catch (error) {
        setResult({
          ok: false,
          status: 0,
          operation,
          data: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
      } finally {
        setRunningOperation(undefined);
      }
    },
    [onLoadSnapshot],
  );

  const handleSaveHandwriting = useCallback(() => {
    void runProductAction("handwriting.save", () =>
      saveProductHandwriting({
        ...baseInput,
        strokes,
        objects,
      }),
    );
  }, [baseInput, objects, runProductAction, strokes]);

  const handleLoadHandwriting = useCallback(() => {
    void runProductAction("handwriting.load", () =>
      loadProductHandwriting({
        ...baseInput,
        key: lastKey || defaultKey,
      }),
    );
  }, [baseInput, defaultKey, lastKey, runProductAction]);

  const handleTransformHandwriting = useCallback(() => {
    void runProductAction("handwriting.transform", () =>
      transformProductHandwriting({
        ...baseInput,
        sourceKey: lastKey || defaultKey,
      }),
    );
  }, [baseInput, defaultKey, lastKey, runProductAction]);

  const handleFrameActivity = useCallback(() => {
    void runProductAction("frame-activity.save", () =>
      runFrameActivityInternalDataFlow(baseInput),
    );
  }, [baseInput, runProductAction]);

  const handleMissing = useCallback(() => {
    void runProductAction("handwriting.missing", () =>
      loadProductHandwriting({
        ...baseInput,
        key: "mildang-product/handwriting/missing/does-not-exist.json",
      }),
    );
  }, [baseInput, runProductAction]);

  const isRunning = runningOperation !== undefined;

  return (
    <details className="product-trace-debug" open>
      <summary aria-label="Product trace debug status">
        <strong>Product Trace</strong>
        <span>{runningOperation || getStatusText(result)}</span>
      </summary>
      <div className="product-trace-debug-actions">
        <button
          type="button"
          onClick={handleSaveHandwriting}
          disabled={isRunning}
        >
          Save HW
        </button>
        <button
          type="button"
          onClick={handleLoadHandwriting}
          disabled={isRunning}
        >
          Load HW
        </button>
        <button
          type="button"
          onClick={handleTransformHandwriting}
          disabled={isRunning || !lastKey}
        >
          Transform
        </button>
        <button
          type="button"
          onClick={handleFrameActivity}
          disabled={isRunning}
        >
          Frame
        </button>
        <button type="button" onClick={handleMissing} disabled={isRunning}>
          Missing
        </button>
      </div>
      <dl>
        <div>
          <dt>status</dt>
          <dd>{result ? (result.ok ? "ok" : "error") : "-"}</dd>
        </div>
        <div>
          <dt>key</dt>
          <dd>{getResultKey(result)}</dd>
        </div>
        <div>
          <dt>elements</dt>
          <dd>{result?.elementsCount ?? "-"}</dd>
        </div>
        <div>
          <dt>trace</dt>
          <dd>{result?.traceId?.slice(0, 8) ?? "-"}</dd>
        </div>
      </dl>
      <small>{serverUrl}</small>
    </details>
  );
}

export default ProductTracePanel;
