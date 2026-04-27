import { Perf } from 'r3f-perf';

export function PerformanceMonitor() {
  return (
    <Perf
      className="r3f-perf-debug"
      position="bottom-left"
      style={{
        top: 'auto',
        right: 'auto',
        bottom: 12,
        left: 12,
        zIndex: 140,
      }}
    />
  );
}
