import { useCallback, useMemo, useState } from "react";
import {
  checkStorageHealth,
  getStorageJson,
  makeStorageDemoKey,
  transformStorageJson,
  uploadStorageJson,
  type StorageTraceResponse,
} from "../../../lib/storageTraceClient";

type StorageTraceDebugPanelProps = {
  serverUrl: string;
  roomId: string;
  actorId: string;
};

function getStatusText(result: StorageTraceResponse | undefined): string {
  if (!result) return "idle";
  return `${result.operation} ${result.status}`;
}

function getResultKey(result: StorageTraceResponse | undefined): string {
  return result?.targetKey || result?.key || "-";
}

export function StorageTraceDebugPanel({
  serverUrl,
  roomId,
  actorId,
}: StorageTraceDebugPanelProps): JSX.Element {
  const [result, setResult] = useState<StorageTraceResponse>();
  const [lastKey, setLastKey] = useState<string>();
  const [runningOperation, setRunningOperation] = useState<string>();
  const baseJson = useMemo(
    () => ({
      roomId,
      actorId,
      score: 87,
      answers: [{ id: "q1", value: "A" }],
      createdAt: new Date().toISOString(),
    }),
    [actorId, roomId],
  );

  const runStorageAction = useCallback(
    async (operation: string, action: () => Promise<StorageTraceResponse>) => {
      setRunningOperation(operation);
      try {
        const nextResult = await action();
        setResult(nextResult);
        if (nextResult.key) setLastKey(nextResult.key);
        if (nextResult.targetKey) setLastKey(nextResult.targetKey);
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
    [],
  );

  const handleHealth = useCallback(() => {
    void runStorageAction("health", () => checkStorageHealth(serverUrl));
  }, [runStorageAction, serverUrl]);

  const handleUpload = useCallback(() => {
    const key = makeStorageDemoKey("upload");
    void runStorageAction("put-json", () =>
      uploadStorageJson({
        serverUrl,
        key,
        json: baseJson,
      }),
    );
  }, [baseJson, runStorageAction, serverUrl]);

  const handleGet = useCallback(() => {
    if (!lastKey) return;
    void runStorageAction("get-json", () =>
      getStorageJson({
        serverUrl,
        key: lastKey,
      }),
    );
  }, [lastKey, runStorageAction, serverUrl]);

  const handleTransform = useCallback(() => {
    if (!lastKey) return;
    const targetKey = makeStorageDemoKey("transform");
    void runStorageAction("transform-json", () =>
      transformStorageJson({
        serverUrl,
        sourceKey: lastKey,
        targetKey,
        patch: {
          reviewed: true,
          score: 91,
        },
      }),
    );
  }, [lastKey, runStorageAction, serverUrl]);

  const handleMissingKey = useCallback(() => {
    void runStorageAction("get-json", () =>
      getStorageJson({
        serverUrl,
        key: "json/does-not-exist-from-frontend.json",
      }),
    );
  }, [runStorageAction, serverUrl]);

  const isRunning = runningOperation !== undefined;

  return (
    <details className="storage-trace-debug" open>
      <summary aria-label="Storage trace debug status">
        <strong>Storage</strong>
        <span>{runningOperation || getStatusText(result)}</span>
      </summary>
      <div className="storage-trace-debug-actions">
        <button type="button" onClick={handleHealth} disabled={isRunning}>
          Health
        </button>
        <button type="button" onClick={handleUpload} disabled={isRunning}>
          Upload
        </button>
        <button
          type="button"
          onClick={handleGet}
          disabled={isRunning || !lastKey}
        >
          Get
        </button>
        <button
          type="button"
          onClick={handleTransform}
          disabled={isRunning || !lastKey}
        >
          Transform
        </button>
        <button type="button" onClick={handleMissingKey} disabled={isRunning}>
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
          <dt>server</dt>
          <dd>{serverUrl}</dd>
        </div>
      </dl>
      <small>{result?.traceparent ?? "-"}</small>
    </details>
  );
}

export default StorageTraceDebugPanel;
