import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Stroke, WebGLObject } from "../../../types/editor";
import type {
  RealtimeInkStatus,
  RealtimeInkYjsDebug,
} from "../../../lib/realtimeInkProtocol";
import type { EditorRenderStats } from "../scene/EditorScene";

type FrameSample = {
  at: number;
  delta: number;
};

type FrameSummary = {
  fps: number;
  minFps: number;
  avgFrameMs: number;
  p95FrameMs: number;
  maxFrameMs: number;
  long50: number;
  long100: number;
  long200: number;
  sampleCount: number;
  totalFrames: number;
  totalLong50: number;
  totalLong100: number;
  totalLong200: number;
  uptimeMs: number;
};

type MemorySummary = {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
};

type RealtimeInkPerfSnapshot = {
  collectedAt: string;
  roomId: string;
  actor: {
    id: string;
    role: string;
  };
  status: RealtimeInkStatus;
  browser: {
    userAgent: string;
    devicePixelRatio: number;
    viewport: {
      width: number;
      height: number;
    };
    memory: MemorySummary | undefined;
  };
  canvas: {
    strokes: number;
    strokePoints: number;
    averagePointsPerStroke: number;
    objects: number;
    images: number;
    imageBytes: number;
    remoteDrafts: number;
  };
  realtime: RealtimeInkYjsDebug;
  frame: FrameSummary;
  webgl: EditorRenderStats | undefined;
};

type RealtimeInkPerfProbePanelProps = {
  status: RealtimeInkStatus;
  roomId: string;
  actorId: string;
  actorRole: string;
  strokes: Stroke[];
  objects: WebGLObject[];
  remoteDraftCount: number;
  yjsDebug: RealtimeInkYjsDebug;
  renderStats: EditorRenderStats | undefined;
};

declare global {
  interface Window {
    __realtimeInkPerfSnapshot?: RealtimeInkPerfSnapshot;
  }
}

const frameWindowMs = 10_000;
const emptyFrameSummary: FrameSummary = {
  fps: 0,
  minFps: 0,
  avgFrameMs: 0,
  p95FrameMs: 0,
  maxFrameMs: 0,
  long50: 0,
  long100: 0,
  long200: 0,
  sampleCount: 0,
  totalFrames: 0,
  totalLong50: 0,
  totalLong100: 0,
  totalLong200: 0,
  uptimeMs: 0,
};

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function getFrameSummary(
  samples: FrameSample[],
  totals: {
    startedAt: number;
    totalFrames: number;
    totalLong50: number;
    totalLong100: number;
    totalLong200: number;
  },
  now: number,
): FrameSummary {
  if (samples.length === 0) {
    return {
      ...emptyFrameSummary,
      totalFrames: totals.totalFrames,
      totalLong50: totals.totalLong50,
      totalLong100: totals.totalLong100,
      totalLong200: totals.totalLong200,
      uptimeMs: now - totals.startedAt,
    };
  }

  const deltas = samples.map((sample) => sample.delta);
  const averageFrameMs =
    deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length;
  const maxFrameMs = Math.max(...deltas);

  return {
    fps: averageFrameMs > 0 ? 1000 / averageFrameMs : 0,
    minFps: maxFrameMs > 0 ? 1000 / maxFrameMs : 0,
    avgFrameMs: averageFrameMs,
    p95FrameMs: percentile(deltas, 95),
    maxFrameMs,
    long50: deltas.filter((delta) => delta >= 50).length,
    long100: deltas.filter((delta) => delta >= 100).length,
    long200: deltas.filter((delta) => delta >= 200).length,
    sampleCount: samples.length,
    totalFrames: totals.totalFrames,
    totalLong50: totals.totalLong50,
    totalLong100: totals.totalLong100,
    totalLong200: totals.totalLong200,
    uptimeMs: now - totals.startedAt,
  };
}

function getMemorySummary(): MemorySummary | undefined {
  const performanceWithMemory = performance as Performance & {
    memory?: MemorySummary;
  };
  return performanceWithMemory.memory;
}

function formatNumber(value: number, fractionDigits = 0): string {
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString("ko-KR", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  });
}

function formatMs(value: number): string {
  return `${formatNumber(value, 1)}ms`;
}

function formatFps(value: number): string {
  return formatNumber(value, 1);
}

function formatBytes(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let nextValue = value;
  let unitIndex = 0;
  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }
  return `${formatNumber(nextValue, unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function countStrokePoints(strokes: Stroke[]): number {
  return strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
}

function countImageBytes(objects: WebGLObject[]): number {
  return objects.reduce((sum, object) => {
    if (object.kind !== "image" || !object.imageSrc) return sum;
    return sum + object.imageSrc.length;
  }, 0);
}

function downloadJson(filename: string, content: unknown) {
  const blob = new Blob([JSON.stringify(content, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function RealtimeInkPerfProbePanel(
  props: RealtimeInkPerfProbePanelProps,
): JSX.Element {
  const {
    status,
    roomId,
    actorId,
    actorRole,
    strokes,
    objects,
    remoteDraftCount,
    yjsDebug,
    renderStats,
  } = props;
  const samplesReference = useRef<FrameSample[]>([]);
  const totalsReference = useRef({
    startedAt: performance.now(),
    totalFrames: 0,
    totalLong50: 0,
    totalLong100: 0,
    totalLong200: 0,
  });
  const [frameSummary, setFrameSummary] = useState(emptyFrameSummary);
  const [memorySummary, setMemorySummary] = useState(getMemorySummary);
  const pointCount = useMemo(() => countStrokePoints(strokes), [strokes]);
  const averagePointsPerStroke =
    strokes.length > 0 ? pointCount / strokes.length : 0;
  const imageBytes = useMemo(() => countImageBytes(objects), [objects]);

  useEffect(() => {
    let animationFrame = 0;
    let lastFrameAt = performance.now();
    let lastPublishAt = 0;

    const updateFrame = (now: number) => {
      const delta = now - lastFrameAt;
      lastFrameAt = now;

      if (delta > 0) {
        const totals = totalsReference.current;
        totals.totalFrames += 1;
        if (delta >= 50) totals.totalLong50 += 1;
        if (delta >= 100) totals.totalLong100 += 1;
        if (delta >= 200) totals.totalLong200 += 1;

        samplesReference.current.push({ at: now, delta });
        const windowStart = now - frameWindowMs;
        samplesReference.current = samplesReference.current.filter(
          (sample) => sample.at >= windowStart,
        );
      }

      if (now - lastPublishAt >= 500) {
        lastPublishAt = now;
        setFrameSummary(
          getFrameSummary(
            samplesReference.current,
            totalsReference.current,
            now,
          ),
        );
        setMemorySummary(getMemorySummary());
      }

      animationFrame = window.requestAnimationFrame(updateFrame);
    };

    animationFrame = window.requestAnimationFrame(updateFrame);
    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  const snapshot = useMemo<RealtimeInkPerfSnapshot>(
    () => ({
      collectedAt: new Date().toISOString(),
      roomId,
      actor: {
        id: actorId,
        role: actorRole,
      },
      status,
      browser: {
        userAgent: window.navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        memory: memorySummary,
      },
      canvas: {
        strokes: strokes.length,
        strokePoints: pointCount,
        averagePointsPerStroke,
        objects: objects.length,
        images: objects.filter((object) => object.kind === "image").length,
        imageBytes,
        remoteDrafts: remoteDraftCount,
      },
      realtime: yjsDebug,
      frame: frameSummary,
      webgl: renderStats,
    }),
    [
      actorId,
      actorRole,
      averagePointsPerStroke,
      frameSummary,
      imageBytes,
      memorySummary,
      objects,
      pointCount,
      remoteDraftCount,
      renderStats,
      roomId,
      status,
      strokes.length,
      yjsDebug,
    ],
  );

  useEffect(() => {
    window.__realtimeInkPerfSnapshot = snapshot;
    return () => {
      if (window.__realtimeInkPerfSnapshot === snapshot) {
        delete window.__realtimeInkPerfSnapshot;
      }
    };
  }, [snapshot]);

  const handleCopy = useCallback(() => {
    void window.navigator.clipboard?.writeText(JSON.stringify(snapshot, null, 2));
  }, [snapshot]);

  const handleDownload = useCallback(() => {
    downloadJson(`realtime-ink-perf-${Date.now()}.json`, snapshot);
  }, [snapshot]);

  const handleReset = useCallback(() => {
    const now = performance.now();
    samplesReference.current = [];
    totalsReference.current = {
      startedAt: now,
      totalFrames: 0,
      totalLong50: 0,
      totalLong100: 0,
      totalLong200: 0,
    };
    setFrameSummary(emptyFrameSummary);
  }, []);

  return (
    <details className="realtime-ink-perf-probe" open>
      <summary aria-label="Realtime Ink performance probe">
        <strong>성능 계측</strong>
        <span>{formatFps(frameSummary.fps)} FPS</span>
      </summary>
      <dl>
        <div>
          <dt>rAF FPS 평균/최저</dt>
          <dd>
            {formatFps(frameSummary.fps)} / {formatFps(frameSummary.minFps)}
          </dd>
        </div>
        <div>
          <dt>프레임 평균/p95/최대</dt>
          <dd>
            {formatMs(frameSummary.avgFrameMs)} /{" "}
            {formatMs(frameSummary.p95FrameMs)} /{" "}
            {formatMs(frameSummary.maxFrameMs)}
          </dd>
        </div>
        <div>
          <dt>긴 프레임 50/100/200</dt>
          <dd>
            {frameSummary.long50}/{frameSummary.long100}/
            {frameSummary.long200}
          </dd>
        </div>
        <div>
          <dt>선/포인트</dt>
          <dd>
            {strokes.length}/{formatNumber(pointCount)}
          </dd>
        </div>
        <div>
          <dt>평균 포인트/선</dt>
          <dd>{formatNumber(averagePointsPerStroke, 1)}</dd>
        </div>
        <div>
          <dt>오브젝트/임시선</dt>
          <dd>
            {objects.length}/{remoteDraftCount}
          </dd>
        </div>
        <div>
          <dt>이미지 용량</dt>
          <dd>{formatBytes(imageBytes)}</dd>
        </div>
        <div>
          <dt>힙 사용</dt>
          <dd>{formatBytes(memorySummary?.usedJSHeapSize)}</dd>
        </div>
        <div>
          <dt>WebGL draw</dt>
          <dd>{formatNumber(renderStats?.calls ?? 0)}</dd>
        </div>
        <div>
          <dt>삼각형</dt>
          <dd>{formatNumber(renderStats?.triangles ?? 0)}</dd>
        </div>
        <div>
          <dt>geo/tex/prog</dt>
          <dd>
            {formatNumber(renderStats?.geometries ?? 0)}/
            {formatNumber(renderStats?.textures ?? 0)}/
            {formatNumber(renderStats?.programs ?? 0)}
          </dd>
        </div>
      </dl>
      <div className="realtime-ink-perf-actions">
        <button type="button" onClick={handleCopy}>
          복사
        </button>
        <button type="button" onClick={handleDownload}>
          JSON
        </button>
        <button type="button" onClick={handleReset}>
          리셋
        </button>
      </div>
      <small>{`${actorRole} / ${actorId}`}</small>
      <small>{roomId}</small>
    </details>
  );
}

export default RealtimeInkPerfProbePanel;
