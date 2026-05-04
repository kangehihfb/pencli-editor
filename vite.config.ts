import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

function readJsonRequest(request: import("node:http").IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJsonResponse(
  response: import("node:http").ServerResponse,
  statusCode: number,
  payload: unknown,
) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

type RectLike = {
  x: number;
  y: number;
  width: number;
  height: number;
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

function serializeRect(rect: RectLike) {
  return {
    x: Number(rect.x.toFixed(2)),
    y: Number(rect.y.toFixed(2)),
    width: Number(rect.width.toFixed(2)),
    height: Number(rect.height.toFixed(2)),
    top: Number((rect.top ?? rect.y).toFixed(2)),
    right: Number((rect.right ?? rect.x + rect.width).toFixed(2)),
    bottom: Number((rect.bottom ?? rect.y + rect.height).toFixed(2)),
    left: Number((rect.left ?? rect.x).toFixed(2)),
  };
}

function playwrightExportPlugin(): Plugin {
  return {
    name: "playwright-export-api",
    configureServer(server) {
      server.middlewares.use(
        "/api/playwright-export",
        async (request, response) => {
          if (request.method !== "POST") {
            sendJsonResponse(response, 405, {
              ok: false,
              error: "Method not allowed.",
            });
            return;
          }

          try {
            const body = await readJsonRequest(request);
            const origin = `http://${request.headers.host ?? "127.0.0.1:5173"}`;
            const targetUrl =
              typeof body.targetUrl === "string" &&
              body.targetUrl.startsWith(origin)
                ? body.targetUrl
                : origin;
            const viewportWidth = Number(body.viewportWidth ?? 1600);
            const viewportHeight = Number(body.viewportHeight ?? 1074);
            const deviceScaleFactor = Number(body.deviceScaleFactor ?? 1);
            const editorState = body.editorState ?? null;
            const outputDir = path.resolve(
              server.config.root,
              "export-results",
            );

            await mkdir(outputDir, { recursive: true });

            const browser = await chromium.launch({ headless: true });

            try {
              const context = await browser.newContext({
                viewport: {
                  width: viewportWidth,
                  height: viewportHeight,
                },
                deviceScaleFactor,
              });
              const page = await context.newPage();
              if (editorState) {
                await page.addInitScript((state) => {
                  window.localStorage.setItem(
                    "__page_export_state__",
                    JSON.stringify(state),
                  );
                }, editorState);
              }

              await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
              await page.locator(".stage-canvas-shell").waitFor({
                state: "visible",
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
              await page.waitForTimeout(800);

              const shell = page.locator(".stage-canvas-shell");
              const shellBox = await shell.boundingBox();
              const now = new Date();
              const stamp = now.toISOString().replaceAll(/[.:]/g, "-");
              const screenshotFilename = `playwright-stage-canvas-shell-${stamp}.png`;
              const jsonFilename = `playwright-stage-canvas-shell-${stamp}.json`;
              const screenshotPath = path.join(outputDir, screenshotFilename);
              const jsonPath = path.join(outputDir, jsonFilename);

              await shell.screenshot({
                path: screenshotPath,
                animations: "disabled",
              });
              const screenshotBuffer = await readFile(screenshotPath);

              const environment = await page.evaluate(() => {
                const rectToJson = (rect: DOMRect) => ({
                  x: Number(rect.x.toFixed(2)),
                  y: Number(rect.y.toFixed(2)),
                  width: Number(rect.width.toFixed(2)),
                  height: Number(rect.height.toFixed(2)),
                  top: Number(rect.top.toFixed(2)),
                  right: Number(rect.right.toFixed(2)),
                  bottom: Number(rect.bottom.toFixed(2)),
                  left: Number(rect.left.toFixed(2)),
                });

                const pageElement = document.querySelector(
                  ".stage-react-exam-page",
                );
                const shellElement = document.querySelector(
                  ".stage-canvas-shell",
                );
                const canvasElement = document.querySelector<HTMLCanvasElement>(
                  "canvas.stage-canvas, .stage-canvas canvas, canvas",
                );
                const frameElement = document.querySelector(
                  ".stage-canvas-frame",
                );
                const frameStyle = frameElement
                  ? window.getComputedStyle(frameElement)
                  : null;

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
                          height: Number(
                            window.visualViewport.height.toFixed(2),
                          ),
                          scale: Number(window.visualViewport.scale.toFixed(4)),
                          offsetLeft: Number(
                            window.visualViewport.offsetLeft.toFixed(2),
                          ),
                          offsetTop: Number(
                            window.visualViewport.offsetTop.toFixed(2),
                          ),
                        }
                      : null,
                  },
                  page: pageElement
                    ? {
                        rect: rectToJson(pageElement.getBoundingClientRect()),
                      }
                    : null,
                  shell: shellElement
                    ? {
                        rect: rectToJson(shellElement.getBoundingClientRect()),
                      }
                    : null,
                  canvas: canvasElement
                    ? {
                        rect: rectToJson(canvasElement.getBoundingClientRect()),
                        bufferWidth: canvasElement.width,
                        bufferHeight: canvasElement.height,
                      }
                    : null,
                  frame: frameElement
                    ? {
                        rect: rectToJson(frameElement.getBoundingClientRect()),
                        cssStagePageScale:
                          frameStyle
                            ?.getPropertyValue("--stage-page-scale")
                            .trim() || null,
                        cssStagePageWidth:
                          frameStyle
                            ?.getPropertyValue("--stage-page-width")
                            .trim() || null,
                        cssStagePageHeight:
                          frameStyle
                            ?.getPropertyValue("--stage-page-height")
                            .trim() || null,
                      }
                    : null,
                };
              });

              const result = {
                ok: true,
                method: "playwright-element-screenshot",
                targetUrl,
                viewport: {
                  width: viewportWidth,
                  height: viewportHeight,
                  deviceScaleFactor,
                },
                output: {
                  screenshotPath,
                  screenshotFilename,
                  jsonPath,
                  jsonFilename,
                  shellBox: shellBox ? serializeRect(shellBox) : null,
                },
                image: {
                  mimeType: "image/png",
                  base64: screenshotBuffer.toString("base64"),
                },
                environment,
              };

              await writeFile(
                jsonPath,
                `${JSON.stringify(result, null, 2)}\n`,
                "utf8",
              );
              sendJsonResponse(response, 200, result);
            } finally {
              await browser.close();
            }
          } catch (error) {
            sendJsonResponse(response, 500, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), playwrightExportPlugin()],
});
