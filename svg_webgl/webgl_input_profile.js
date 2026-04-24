export const getPointerType = (event) => event.pointerType || "mouse";

export const detectDeviceContext = (nav = navigator) => {
  const ua = nav.userAgent || "";
  const maxTouchPoints = nav.maxTouchPoints || 0;
  const isIPadLike = /iPad/i.test(ua) || (ua.includes("Macintosh") && maxTouchPoints > 1);
  const isTouchCapable = maxTouchPoints > 0;
  const isMobileInput = isTouchCapable || /Android|iPhone|iPod/i.test(ua) || isIPadLike;
  return {
    ua,
    maxTouchPoints,
    isIPadLike,
    isTouchCapable,
    isMobileInput,
  };
};

export const createInputTuning = (deviceContext) => {
  const isMobile = deviceContext.isMobileInput;
  return {
    minDistancePxByPointer: {
      pen: isMobile ? 0.45 : 0.9,
      touch: isMobile ? 0.9 : 1.1,
      mouse: 1.4,
      default: 1.2,
    },
    duplicateWindowMs: isMobile ? 340 : 260,
    duplicatePointDelta: isMobile ? 3 : 2,
    duplicateThresholdPx: isMobile ? 6 : 8,
    penSuppressTouchMsOnStart: isMobile ? 300 : 250,
    penSuppressTouchMsOnEnd: isMobile ? 700 : 500,
    penPriorityMsOnStart: isMobile ? 1500 : 1200,
    penPriorityMsOnEnd: isMobile ? 900 : 700,
  };
};

export const getMinStrokeDistanceWorld = (pointerType, zoom, tuning) => {
  const px = tuning.minDistancePxByPointer[pointerType] ?? tuning.minDistancePxByPointer.default;
  return px / Math.max(0.0001, zoom || 1);
};

export const isLikelyDuplicateStroke = ({ current, previous, nowMs, zoom, tuning }) => {
  if (!current || !previous) return false;
  if (!current.points || !previous.points) return false;
  if (current.points.length < 2 || previous.points.length < 2) return false;
  const prevEndedAt = previous.endedAt || 0;
  if (!prevEndedAt || nowMs - prevEndedAt > tuning.duplicateWindowMs) return false;
  if (Math.abs(current.points.length - previous.points.length) > tuning.duplicatePointDelta) return false;
  const a0 = current.points[0];
  const a1 = current.points[current.points.length - 1];
  const b0 = previous.points[0];
  const b1 = previous.points[previous.points.length - 1];
  const threshold = tuning.duplicateThresholdPx / Math.max(0.0001, zoom || 1);
  const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) <= threshold;
  return near(a0, b0) && near(a1, b1);
};
