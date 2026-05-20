/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OTEL_ENABLED?: string;
  readonly VITE_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?: string;
  readonly VITE_OTEL_SERVICE_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// eslint-disable-next-line no-var
declare var __pentest_otel_web_provider__: unknown;
// eslint-disable-next-line no-var
declare var __pentest_otel_meter_provider__: unknown;

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

interface Window {
  __realtimeInkReceiveDiagnostics?: RealtimeInkReceiveDiagnostics;
}
