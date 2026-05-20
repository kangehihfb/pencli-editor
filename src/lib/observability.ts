import {
  context,
  defaultTextMapGetter,
  metrics,
  propagation,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from "@opentelemetry/api";
import { getWebAutoInstrumentations } from "@opentelemetry/auto-instrumentations-web";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";

export type TraceCarrier = Record<string, string>;

const serviceName =
  import.meta.env.VITE_OTEL_SERVICE_NAME ?? "pentest-frontend";
const tracesEndpoint = getTracesEndpoint();
const otelEnabled = import.meta.env.VITE_OTEL_ENABLED !== "0";

function getOptionalNumberParameter(
  parameters: URLSearchParams,
  name: string,
): number | undefined {
  const value = parameters.get(name);
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getTestAttributes(): Attributes {
  const parameters = new URLSearchParams(globalThis.location.search);
  const runId = parameters.get("testRunId") ?? parameters.get("loadTestId");
  const scenario = parameters.get("testScenario");
  const stack = parameters.get("testStack");
  const rooms = getOptionalNumberParameter(parameters, "testRooms");
  const users = getOptionalNumberParameter(parameters, "testUsers");
  const concurrency = getOptionalNumberParameter(parameters, "testConcurrency");
  const attributes: Attributes = {};

  if (runId) attributes["test.run_id"] = runId;
  if (scenario) attributes["test.scenario"] = scenario;
  if (stack) attributes["test.stack"] = stack;
  if (rooms !== undefined) attributes["test.rooms"] = rooms;
  if (users !== undefined) attributes["test.users"] = users;
  if (concurrency !== undefined) attributes["test.concurrency"] = concurrency;

  return attributes;
}

function withCommonAttributes(attributes: Attributes): Attributes {
  return {
    ...getTestAttributes(),
    ...attributes,
  };
}

function getTracesEndpoint(): string {
  const parameters = new URLSearchParams(globalThis.location.search);
  return (
    parameters.get("otelEndpoint") ??
    import.meta.env.VITE_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
    "http://127.0.0.1:3000/otel/v1/traces"
  );
}

function setupOpenTelemetry() {
  if (!otelEnabled) return;

  if (globalThis.__pentest_otel_web_provider__) return;

  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      "service.name": serviceName,
      "deployment.environment.name": import.meta.env.MODE || "local",
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: tracesEndpoint,
        }),
        {
          scheduledDelayMillis: 500,
          exportTimeoutMillis: 5000,
        },
      ),
    ],
  });

  provider.register();

  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      // fetch 자동 추적 (S3 presigned URL, 백엔드 REST API)
      getWebAutoInstrumentations({
        "@opentelemetry/instrumentation-fetch": {
          enabled: true,
          ignoreUrls: [/\/otel\/v1\/traces/],
          propagateTraceHeaderCorsUrls: [/.*/],
        },
        "@opentelemetry/instrumentation-user-interaction": {
          enabled: false,
        },
      }),
      // 페이지 초기 로드 타이밍 자동 추적 (documentLoad, resourceFetch)
      new DocumentLoadInstrumentation(),
      // XHR 자동 추적 (라이브러리 내부 XHR 호출)
      new XMLHttpRequestInstrumentation({
        ignoreUrls: [/\/otel\/v1\/traces/],
        propagateTraceHeaderCorsUrls: [/.*/],
      }),
    ],
  });

  globalThis.__pentest_otel_web_provider__ = provider;

  // 4-5: MetricProvider 설정 — SigNoz Metrics 탭에서 frame time 등 확인
  if (!globalThis.__pentest_otel_meter_provider__) {
    const metricsEndpoint = tracesEndpoint.replace(
      /\/v1\/traces$/,
      "/v1/metrics",
    );
    const meterProvider = new MeterProvider({
      resource: resourceFromAttributes({
        "service.name": serviceName,
        "deployment.environment.name": import.meta.env.MODE || "local",
      }),
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: metricsEndpoint }),
          exportIntervalMillis: 15_000,
          exportTimeoutMillis: 10_000,
        }),
      ],
    });

    metrics.setGlobalMeterProvider(meterProvider);
    globalThis.__pentest_otel_meter_provider__ = meterProvider;
  }
}

setupOpenTelemetry();

export const frontendTracer = trace.getTracer(serviceName);
export const frontendMeter = metrics.getMeter(serviceName);

// 4-5: Frame time gauge — EditorScene의 addAfterEffect에서 기록
const frameTimeGauge = otelEnabled
  ? frontendMeter.createGauge("client.render.frame_time", {
      description: "Time to render one frame (ms)",
      unit: "ms",
    })
  : undefined;

let _lastFrameTime = performance.now();

export function recordFrameTime(
  actorId: string,
  strokeCount: number,
): void {
  if (!frameTimeGauge) return;
  const now = performance.now();
  const frameTimeMs = now - _lastFrameTime;
  _lastFrameTime = now;
  frameTimeGauge.record(frameTimeMs, {
    ...getTestAttributes(),
    "actor.id": actorId,
    "scene.stroke.count": strokeCount,
  });
}

export function recordSpanError(span: Span, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  span.recordException(
    error instanceof Error
      ? error
      : {
          name: "Error",
          message,
        },
  );
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message,
  });
}

export function startFrontendSpan(name: string, attributes: Attributes): Span {
  return frontendTracer.startSpan(name, {
    attributes: withCommonAttributes(attributes),
  });
}

export async function runWithFrontendSpan<T>(
  name: string,
  attributes: Attributes,
  work: (span: Span) => Promise<T>,
): Promise<T> {
  const span = startFrontendSpan(name, attributes);
  const activeContext = trace.setSpan(context.active(), span);

  return context.with(activeContext, async () => {
    try {
      return await work(span);
    } catch (error) {
      recordSpanError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

export function runFrontendSpan<T>(
  name: string,
  attributes: Attributes,
  work: (span: Span) => T,
): T {
  const span = startFrontendSpan(name, attributes);
  const activeContext = trace.setSpan(context.active(), span);

  return context.with(activeContext, () => {
    try {
      return work(span);
    } catch (error) {
      recordSpanError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

export function startFrontendSpanFromCarrier(
  name: string,
  attributes: Attributes,
  traceCarrier: TraceCarrier | undefined,
): Span {
  const parentContext = traceCarrier?.traceparent
    ? propagation.extract(ROOT_CONTEXT, traceCarrier, defaultTextMapGetter)
    : undefined;
  return frontendTracer.startSpan(
    name,
    { attributes: withCommonAttributes(attributes) },
    parentContext,
  );
}

export function makeTraceCarrier(span: Span): TraceCarrier {
  const carrier: TraceCarrier = {};
  propagation.inject(trace.setSpan(context.active(), span), carrier);
  return carrier;
}
