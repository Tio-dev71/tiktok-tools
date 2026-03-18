import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import ffmpeg from "fluent-ffmpeg";

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export async function renderVideoByBrowser(payload: any) {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: {
      width: 1200,
      height: 2000,
      deviceScaleFactor: 1,
    },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
  });

  try {
    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());

    page.on("console", (msg) => {
      console.log("[RenderWorkerConsole]", msg.text());
    });

    page.on("pageerror", (err) => {
      console.error("[RenderWorkerPageError]", err);
    });

    const appUrl = process.env.APP_URL || "http://localhost:3000";

    await page.goto(`${appUrl}/render-worker`, {
      waitUntil: "networkidle0",
    });

    await page.bringToFront();

    await page.waitForFunction(
      () => typeof (window as any).renderNewsVideoForAutomation === "function",
      { timeout: 15000 }
    );

    const result = await page.evaluate(async (input) => {
      // @ts-ignore
      return await window.renderNewsVideoForAutomation(input);
    }, payload);

    console.log("[BrowserRenderer] mimeType:", result?.mimeType);
    console.log("[BrowserRenderer] base64 length:", result?.base64?.length || 0);

    if (!result?.base64) {
      throw new Error("Render worker không trả về video");
    }

    const outputDir = path.resolve(process.env.OUTPUT_DIR || "./output");
    ensureDir(outputDir);

    const tempWebmPath = path.join(outputDir, `video-${Date.now()}.webm`);
    fs.writeFileSync(tempWebmPath, Buffer.from(result.base64, "base64"));

    const webmStat = fs.statSync(tempWebmPath);
    console.log("[BrowserRenderer] tempWebmPath:", tempWebmPath);
    console.log("[BrowserRenderer] tempWebm size:", webmStat.size);

    if (webmStat.size < 10000) {
      throw new Error(`File video quá nhỏ (${webmStat.size} bytes), render có thể đã thất bại`);
    }

    const outputPath = tempWebmPath.replace(/\.webm$/, ".mp4");

    await new Promise<void>((resolve, reject) => {
      ffmpeg(tempWebmPath)
        .videoCodec("libx264")
        .audioCodec("aac")
        .outputOptions([
          "-pix_fmt yuv420p",
          "-movflags +faststart"
        ])
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .save(outputPath);
    });

    const mp4Stat = fs.statSync(outputPath);
    console.log("[BrowserRenderer] outputPath:", outputPath);
    console.log("[BrowserRenderer] output size:", mp4Stat.size);

    // muốn thì xóa file webm tạm
    try {
      fs.unlinkSync(tempWebmPath);
    } catch {}

    return {
      outputPath,
      mimeType: "video/mp4",
    };
  } finally {
    await browser.close();
  }
}