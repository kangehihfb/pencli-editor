import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const targetUrl = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outputDir = path.resolve(projectRoot, process.argv[3] ?? 'export-results/pencil-input');
const deviceName = process.env.PENCIL_DEVICE ?? 'Desktop automated pointer';
const osName = process.env.PENCIL_OS ?? process.platform;
const browserName = process.env.PENCIL_BROWSER ?? 'Chromium Playwright';
const inputDevice = process.env.PENCIL_INPUT ?? 'Synthetic pen';
const viewportWidth = Number(process.env.PENCIL_VIEWPORT_WIDTH ?? 1400);
const viewportHeight = Number(process.env.PENCIL_VIEWPORT_HEIGHT ?? 900);
const deviceScaleFactor = Number(process.env.PENCIL_DEVICE_SCALE_FACTOR ?? 1);

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    console.warn('Bundled Playwright Chromium launch failed. Falling back to local Chrome channel.');
    console.warn(error instanceof Error ? error.message : error);
    return chromium.launch({ headless: true, channel: 'chrome' });
  }
}

function markdownEscape(value) {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', '<br>');
}

function summarizePressure(events) {
  const values = events
    .map((event) => event.pressure)
    .filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (values.length === 0) return 'n/a';

  const min = Math.min(...values);
  const max = Math.max(...values);
  return `${min.toFixed(2)}~${max.toFixed(2)}`;
}

function getPointerType(events) {
  const pointerTypes = [...new Set(events.map((event) => event.pointerType).filter(Boolean))];
  return pointerTypes.length > 0 ? pointerTypes.join(', ') : 'n/a';
}

function formatCoordinateError(error) {
  if (!Number.isFinite(error)) return '확인 필요';
  return `${error.toFixed(1)}px`;
}

function makeMarkdownReport(result) {
  const row = [
    result.device.name,
    result.device.os,
    result.device.browser,
    result.url,
    String(result.environment.isSecureContext),
    result.pointer.pointerType,
    result.pointer.pressure,
    result.stroke.firstStrokeMissing ? '있음' : '없음',
    result.stroke.coordinateError,
    result.result,
    result.notes,
  ].map(markdownEscape);

  return `# Pencil Input Compatibility Report

Generated at: ${result.generatedAt}

| 기기 | OS | 브라우저 | URL | Secure Context | pointerType | pressure | 첫 획 누락 | 좌표 오차 | 결과 | 비고 |
|---|---|---|---|---|---|---|---|---|---|---|
| ${row.join(' | ')} |

## Raw Result

\`\`\`json
${JSON.stringify(result, null, 2)}
\`\`\`
`;
}

await mkdir(outputDir, { recursive: true });

const browser = await launchBrowser();

try {
  const context = await browser.newContext({
    viewport: {
      width: viewportWidth,
      height: viewportHeight,
    },
    deviceScaleFactor,
  });
  const page = await context.newPage();

  const consoleMessages = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleMessages.push({
        type: message.type(),
        text: message.text(),
      });
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error instanceof Error ? error.message : String(error));
  });

  const url = new URL(targetUrl);
  url.searchParams.set('pencilCompatRun', Date.now().toString());
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  await page.locator('.stage-canvas-shell').waitFor({
    state: 'visible',
    timeout: 10_000,
  });
  await page.addStyleTag({
    content: `
      #leva__root,
      .r3f-perf-debug {
        display: none !important;
      }
    `,
  });

  await page.getByRole('button', { name: '펜', exact: true }).click({ force: true });
  await page.waitForTimeout(400);

  const result = await page.evaluate(async ({ deviceName, osName, browserName, inputDevice }) => {
    const pointerEvents = [];
    const touchEvents = [];
    const stateEvents = [];

    const recordPointer = (event) => {
      pointerEvents.push({
        type: event.type,
        pointerType: event.pointerType,
        pressure: event.pressure,
        clientX: event.clientX,
        clientY: event.clientY,
        timeStamp: event.timeStamp,
      });
    };
    const recordTouch = (event) => {
      const touch = event.changedTouches.item(0);
      touchEvents.push({
        type: event.type,
        touches: event.touches.length,
        changedTouches: event.changedTouches.length,
        clientX: touch?.clientX ?? null,
        clientY: touch?.clientY ?? null,
        force: typeof touch?.force === 'number' ? touch.force : null,
        timeStamp: event.timeStamp,
      });
    };
    const recordState = (event) => {
      stateEvents.push(event.detail ?? null);
    };

    window.addEventListener('pointerdown', recordPointer, true);
    window.addEventListener('pointermove', recordPointer, true);
    window.addEventListener('pointerup', recordPointer, true);
    window.addEventListener('pointercancel', recordPointer, true);
    window.addEventListener('touchstart', recordTouch, true);
    window.addEventListener('touchmove', recordTouch, true);
    window.addEventListener('touchend', recordTouch, true);
    window.addEventListener('touchcancel', recordTouch, true);
    window.addEventListener('pencil-state-debug', recordState);

    const shell = document.querySelector('.stage-canvas-shell');
    const canvas = document.querySelector('canvas.stage-canvas, .stage-canvas canvas, canvas');
    const capture = document.querySelector('.stage-input-capture');
    if (!shell || !canvas) {
      throw new Error('Missing stage canvas shell or canvas.');
    }

    const countAlphaPixels = () => {
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext('2d');
      context.drawImage(canvas, 0, 0);
      const data = context.getImageData(0, 0, copy.width, copy.height).data;
      let count = 0;
      for (let index = 3; index < data.length; index += 4) {
        if (data[index] > 8) count += 1;
      }
      return count;
    };

    const beforeAlpha = countAlphaPixels();
    const rect = shell.getBoundingClientRect();
    const target = capture || canvas;
    const points = [
      { clientX: rect.left + rect.width * 0.32, clientY: rect.top + rect.height * 0.42, pressure: 0.18 },
      { clientX: rect.left + rect.width * 0.44, clientY: rect.top + rect.height * 0.48, pressure: 0.42 },
      { clientX: rect.left + rect.width * 0.58, clientY: rect.top + rect.height * 0.54, pressure: 0.66 },
    ];

    target.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: 91,
      pointerType: 'pen',
      clientX: points[0].clientX,
      clientY: points[0].clientY,
      pressure: points[0].pressure,
    }));
    await new Promise(requestAnimationFrame);

    for (const point of points.slice(1)) {
      target.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        pointerId: 91,
        pointerType: 'pen',
        clientX: point.clientX,
        clientY: point.clientY,
        pressure: point.pressure,
      }));
      await new Promise(requestAnimationFrame);
    }

    target.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      pointerId: 91,
      pointerType: 'pen',
      clientX: points[points.length - 1].clientX,
      clientY: points[points.length - 1].clientY,
      pressure: 0,
    }));

    await new Promise((resolve) => setTimeout(resolve, 500));

    const afterAlpha = countAlphaPixels();
    const alphaDelta = afterAlpha - beforeAlpha;
    const firstPointerMove = pointerEvents.find((event) => event.type === 'pointermove');
    const expectedFirstMove = points[1];
    const coordinateError = firstPointerMove
      ? Math.hypot(firstPointerMove.clientX - expectedFirstMove.clientX, firstPointerMove.clientY - expectedFirstMove.clientY)
      : Number.NaN;

    window.removeEventListener('pointerdown', recordPointer, true);
    window.removeEventListener('pointermove', recordPointer, true);
    window.removeEventListener('pointerup', recordPointer, true);
    window.removeEventListener('pointercancel', recordPointer, true);
    window.removeEventListener('touchstart', recordTouch, true);
    window.removeEventListener('touchmove', recordTouch, true);
    window.removeEventListener('touchend', recordTouch, true);
    window.removeEventListener('touchcancel', recordTouch, true);
    window.removeEventListener('pencil-state-debug', recordState);

    return {
      generatedAt: new Date().toISOString(),
      url: window.location.href,
      device: {
        name: deviceName,
        os: osName,
        browser: browserName,
        input: inputDevice,
      },
      environment: {
        isSecureContext: window.isSecureContext,
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        devicePixelRatio: window.devicePixelRatio,
        viewport: {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          visualViewport: window.visualViewport
            ? {
                width: Number(window.visualViewport.width.toFixed(2)),
                height: Number(window.visualViewport.height.toFixed(2)),
                scale: Number(window.visualViewport.scale.toFixed(4)),
              }
            : null,
        },
        supports: {
          pointerEvent: typeof PointerEvent !== 'undefined',
          touchEvent: typeof TouchEvent !== 'undefined',
          coalescedEvents: typeof PointerEvent !== 'undefined' && typeof PointerEvent.prototype.getCoalescedEvents === 'function',
          randomUUID: typeof globalThis.crypto?.randomUUID === 'function',
        },
      },
      pointer: {
        events: pointerEvents,
        pointerType: [...new Set(pointerEvents.map((event) => event.pointerType).filter(Boolean))].join(', ') || 'n/a',
        pressureValues: pointerEvents.map((event) => event.pressure),
      },
      touch: {
        events: touchEvents,
      },
      stroke: {
        beforeAlpha,
        afterAlpha,
        alphaDelta,
        firstStrokeMissing: alphaDelta <= 0,
        coordinateError,
        stateEvents,
        usedCaptureLayer: Boolean(capture),
      },
    };
  }, { deviceName, osName, browserName, inputDevice });

  const pressure = summarizePressure(result.pointer.events);
  const pointerType = getPointerType(result.pointer.events);
  const coordinateError = formatCoordinateError(result.stroke.coordinateError);
  const passed = result.stroke.alphaDelta > 0 && pageErrors.length === 0;
  const notes = [
    result.stroke.usedCaptureLayer ? 'capture layer 사용' : 'R3F/canvas 직접 입력',
    result.environment.supports.randomUUID ? 'randomUUID 사용 가능' : 'makeId fallback 필요',
    pageErrors.length > 0 ? `page errors ${pageErrors.length}` : null,
  ].filter(Boolean).join(', ');

  const normalized = {
    ...result,
    pointer: {
      ...result.pointer,
      pointerType,
      pressure,
    },
    stroke: {
      ...result.stroke,
      coordinateError,
    },
    result: passed ? 'PASS' : 'FAIL',
    notes,
    diagnostics: {
      consoleMessages,
      pageErrors,
    },
  };

  const jsonPath = path.join(outputDir, 'pencil-input-compat-report.json');
  const markdownPath = path.join(outputDir, 'pencil-input-compat-report.md');
  await writeFile(jsonPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, makeMarkdownReport(normalized), 'utf8');

  console.log(JSON.stringify({
    result: normalized.result,
    url: normalized.url,
    secureContext: normalized.environment.isSecureContext,
    pointerType: normalized.pointer.pointerType,
    pressure: normalized.pointer.pressure,
    firstStrokeMissing: normalized.stroke.firstStrokeMissing,
    coordinateError: normalized.stroke.coordinateError,
    notes: normalized.notes,
    output: {
      jsonPath,
      markdownPath,
    },
  }, null, 2));
} finally {
  await browser.close();
}
