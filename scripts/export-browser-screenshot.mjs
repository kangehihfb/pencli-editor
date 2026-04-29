import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const targetUrl = process.argv[2] ?? 'http://127.0.0.1:5173/';
const outputDir = path.resolve(
  projectRoot,
  process.argv[3] ?? 'export-results',
);
const viewportWidth = Number(process.env.EXPORT_VIEWPORT_WIDTH ?? 1600);
const viewportHeight = Number(process.env.EXPORT_VIEWPORT_HEIGHT ?? 1074);
const deviceScaleFactor = Number(process.env.EXPORT_DEVICE_SCALE_FACTOR ?? 1);

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    console.warn('Bundled Playwright Chromium launch failed. Falling back to local Chrome channel.');
    console.warn(error instanceof Error ? error.message : error);
    return chromium.launch({ headless: true, channel: 'chrome' });
  }
}

function roundRect(rect) {
  if (!rect) return null;
  return {
    x: Number(rect.x.toFixed(2)),
    y: Number(rect.y.toFixed(2)),
    width: Number(rect.width.toFixed(2)),
    height: Number(rect.height.toFixed(2)),
  };
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

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
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

  // Let R3F, fonts, and layout settle before taking the screenshot.
  await page.waitForTimeout(800);

  const shell = page.locator('.stage-canvas-shell');
  const shellBox = await shell.boundingBox();
  const screenshotPath = path.join(outputDir, 'playwright-stage-canvas-shell.png');
  await shell.screenshot({
    path: screenshotPath,
    animations: 'disabled',
  });

  const environment = await page.evaluate(() => {
    const serializeRect = (rect) => ({
      x: Number(rect.x.toFixed(2)),
      y: Number(rect.y.toFixed(2)),
      width: Number(rect.width.toFixed(2)),
      height: Number(rect.height.toFixed(2)),
      top: Number(rect.top.toFixed(2)),
      right: Number(rect.right.toFixed(2)),
      bottom: Number(rect.bottom.toFixed(2)),
      left: Number(rect.left.toFixed(2)),
    });

    const pageElement = document.querySelector('.stage-react-exam-page');
    const shellElement = document.querySelector('.stage-canvas-shell');
    const canvasElement = document.querySelector(
      'canvas.stage-canvas, .stage-canvas canvas, canvas',
    );
    const frameElement = document.querySelector('.stage-canvas-frame');
    const frameStyle = frameElement ? window.getComputedStyle(frameElement) : null;

    return {
      generatedAt: new Date().toISOString(),
      browser: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
      },
      viewport: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        visualViewport: window.visualViewport
          ? {
              width: Number(window.visualViewport.width.toFixed(2)),
              height: Number(window.visualViewport.height.toFixed(2)),
              scale: Number(window.visualViewport.scale.toFixed(4)),
              offsetLeft: Number(window.visualViewport.offsetLeft.toFixed(2)),
              offsetTop: Number(window.visualViewport.offsetTop.toFixed(2)),
            }
          : null,
      },
      page: pageElement
        ? {
            rect: serializeRect(pageElement.getBoundingClientRect()),
          }
        : null,
      shell: shellElement
        ? {
            rect: serializeRect(shellElement.getBoundingClientRect()),
          }
        : null,
      canvas: canvasElement
        ? {
            rect: serializeRect(canvasElement.getBoundingClientRect()),
            bufferWidth: canvasElement.width,
            bufferHeight: canvasElement.height,
          }
        : null,
      frame: frameElement
        ? {
            rect: serializeRect(frameElement.getBoundingClientRect()),
            cssStagePageScale:
              frameStyle?.getPropertyValue('--stage-page-scale').trim() || null,
            cssStagePageWidth:
              frameStyle?.getPropertyValue('--stage-page-width').trim() || null,
            cssStagePageHeight:
              frameStyle?.getPropertyValue('--stage-page-height').trim() || null,
          }
        : null,
    };
  });

  const result = {
    method: 'playwright-element-screenshot',
    targetUrl,
    viewport: {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor,
    },
    output: {
      screenshotPath,
      shellBox: roundRect(shellBox),
    },
    environment,
  };

  const jsonPath = path.join(outputDir, 'playwright-stage-canvas-shell.json');
  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
