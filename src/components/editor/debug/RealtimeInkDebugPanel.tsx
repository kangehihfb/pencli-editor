import type {
  RealtimeInkRole,
  RealtimeInkStatus,
  RealtimeInkYjsDebug,
} from "../../../lib/realtimeInkProtocol";

type RealtimeInkDebugPanelProps = {
  status: RealtimeInkStatus;
  draftCount: number;
  yjsDebug: RealtimeInkYjsDebug;
  actorRole: RealtimeInkRole;
  actorId: string;
  roomId: string;
};

function formatDebugTime(timestamp: number | undefined): string {
  if (timestamp === undefined) return "-";
  return new Date(timestamp).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function RealtimeInkDebugPanel(
  props: RealtimeInkDebugPanelProps,
): JSX.Element {
  const { status, draftCount, yjsDebug, actorRole, actorId, roomId } = props;

  return (
    <details className="realtime-ink-status" open>
      <summary aria-label="Realtime Ink debug status">
        <strong>Ink</strong>
        <span>{status}</span>
      </summary>
      <dl>
        <div>
          <dt>draft</dt>
          <dd>{draftCount}</dd>
        </div>
        <div>
          <dt>y strokes</dt>
          <dd>{yjsDebug.strokeCount}</dd>
        </div>
        <div>
          <dt>y remote</dt>
          <dd>{yjsDebug.remoteStrokeCount}</dd>
        </div>
        <div>
          <dt>objects</dt>
          <dd>
            {yjsDebug.objectCount}/{yjsDebug.remoteObjectCount}
          </dd>
        </div>
        <div>
          <dt>y updates</dt>
          <dd>
            {yjsDebug.sentUpdateCount}/{yjsDebug.appliedUpdateCount}
          </dd>
        </div>
        <div>
          <dt>sync R/S/A</dt>
          <dd>
            {yjsDebug.syncRequestCount}/{yjsDebug.syncResponseCount}/
            {yjsDebug.syncAppliedCount}
          </dd>
        </div>
        <div>
          <dt>last L/R</dt>
          <dd>
            {formatDebugTime(yjsDebug.lastLocalUpdateAt)} /{" "}
            {formatDebugTime(yjsDebug.lastRemoteUpdateAt)}
          </dd>
        </div>
        <div>
          <dt>last sync</dt>
          <dd>{formatDebugTime(yjsDebug.lastSyncAt)}</dd>
        </div>
      </dl>
      <small>{`${actorRole} / ${actorId}`}</small>
      <small>{roomId}</small>
    </details>
  );
}

export default RealtimeInkDebugPanel;
