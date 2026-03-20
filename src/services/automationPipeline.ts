import fs from "fs";
import { GeminiService } from "./geminiService";
import { renderVideoByBrowser } from "./browserRenderer";
import { uploadToYouTube, uploadToFacebookReels } from "./publishService";
import { sendVideoToTelegram } from "./telegramService";
import path from "path";

type PipelineInput = {
  title: string;
  content: string;
  imageUrl?: string | null;
};

type MediaItem = {
  base64: string;
  mimeType: string;
  startTime?: number;
  endTime?: number;
  duration?: number;
};

async function imageUrlToDataUrl(imageUrl: string): Promise<string> {
  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`Không tải được ảnh từ URL: ${imageUrl}`);
  }

  const contentType = res.headers.get("content-type") || "image/png";
  const arrayBuffer = await res.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  return `data:${contentType};base64,${base64}`;
}

export async function runAutomationPipeline(input: PipelineInput) {
  const gemini = new GeminiService();

  if (!input.content?.trim()) {
    throw new Error("Thiếu content đầu vào");
  }

  console.log("[Pipeline] Bắt đầu generate script");
  let generatedScript = await gemini.generateScript(input.content);
  console.log("[Pipeline] Script xong");

  if (!generatedScript || !generatedScript.trim()) {
    throw new Error("Gemini không trả về script");
  }

  const originalHook = generatedScript.split(/[.\n]/)[0];
  const scriptBody = generatedScript
    .substring(originalHook.length)
    .trim()
    .replace(/^[.\s]+/, "");

  console.log("[Pipeline] Bắt đầu generate title");
  const generatedTitle = await gemini.generateTitle(generatedScript);
  console.log("[Pipeline] Title xong");

  const finalHook = `${originalHook}: ${generatedTitle}`;
  generatedScript = `${finalHook}. ${scriptBody}`;

  console.log("[Pipeline] Bắt đầu generate audio");
  const audioResult = await gemini.generateAudio(generatedScript);
  console.log("[Pipeline] Audio xong");


  if (!audioResult?.base64 || !audioResult.base64.trim()) {
    throw new Error("Gemini không trả về audio");
  }

  const cleanedAudioBase64 = audioResult.base64.trim();
  const audioMimeType = audioResult.mimeType || "audio/mpeg";
  const audioDataUrl = `data:${audioMimeType};base64,${cleanedAudioBase64}`;

  console.log("[Pipeline] audio mimeType:", audioMimeType);
  console.log("[Pipeline] audioDataUrl prefix:", audioDataUrl.slice(0, 80));

  let mediaItems: MediaItem[] = [];

  if (input.imageUrl) {
    try {
      console.log("[Pipeline] Dùng ảnh từ Discord:", input.imageUrl);
      const discordImageDataUrl = await imageUrlToDataUrl(input.imageUrl);

      const mimeType =
        discordImageDataUrl.match(/^data:(.*?);base64,/)?.[1] || "image/png";

      mediaItems = [
        {
          base64: discordImageDataUrl,
          mimeType,
        },
      ];

      console.log("[Pipeline] Lấy ảnh Discord xong");
    } catch (err) {
      console.error("[Pipeline] Lấy ảnh Discord lỗi, fallback local:", err);
    }
  }

  if (mediaItems.length === 0) {
    console.log("[Pipeline] Không có ảnh Discord, dùng fallback local");

    const fallbackPath = path.resolve("public", "effect", "fallback-news.png");
    const fallbackBuffer = fs.readFileSync(fallbackPath);
    const fallbackBase64 = fallbackBuffer.toString("base64");

    mediaItems = [
      {
        base64: `data:image/png;base64,${fallbackBase64}`,
        mimeType: "image/png",
      },
    ];

    console.log("[Pipeline] Dùng ảnh fallback local:", fallbackPath);
  }

  console.log("[Pipeline] Bỏ qua generate ảnh AI, chỉ dùng ảnh Discord/fallback");

  let finalMediaItems = [...mediaItems];

  if (finalMediaItems.length === 0) {
    throw new Error("Không có media item để render");
  }
  console.log("[Pipeline] finalHook:", finalHook);
  console.log("[Pipeline] generatedScript:", generatedScript);
  console.log("[Pipeline] finalMediaItems count:", finalMediaItems.length);
  console.log("[Pipeline] first media mime:", finalMediaItems[0]?.mimeType);
  console.log("[Pipeline] audio mimeType:", audioMimeType);

  console.log("[Pipeline] Bắt đầu render video bằng browser");

  const { outputPath } = await renderVideoByBrowser({
    mediaSources: finalMediaItems,
    audioBase64: cleanedAudioBase64,
    title: finalHook,
    currentMaskUrl: "/effect/news-temp.jpg",
    fullScript: generatedScript,
    bgmBase64: null,
    bgmVolume: 0.2,
  });

  console.log("[Pipeline] Render video xong:", outputPath);

  const videoBuffer = fs.readFileSync(outputPath);

  const results: any = {
    title: finalHook,
    script: generatedScript,
    outputPath,
  };

  if (process.env.AUTO_PUBLISH_YOUTUBE === "true") {
    try {
      console.log("[Pipeline] Bắt đầu upload YouTube");
      results.youtube = {
        success: true,
        data: await uploadToYouTube({
          videoBuffer,
          title: finalHook,
          description: generatedScript,
        }),
      };
      console.log("[Pipeline] Upload YouTube xong");
    } catch (e: any) {
      console.error("[Pipeline] Upload YouTube lỗi:", e);
      results.youtube = { success: false, error: e.message };
    }
  }

  if (process.env.AUTO_PUBLISH_FACEBOOK === "true") {
    try {
      console.log("[Pipeline] Bắt đầu upload Facebook");

      const facebookDescription = `${generatedScript}`;

      results.facebook = {
        success: true,
        data: await uploadToFacebookReels({
          videoBuffer,
          title: facebookDescription, 
          description: facebookDescription,
        }),
      };

      console.log("[Pipeline] Upload Facebook xong");
    } catch (e: any) {
      console.error("[Pipeline] Upload Facebook lỗi:", e);
      results.facebook = { success: false, error: e.message };
    }
  }

  if (process.env.AUTO_SEND_TELEGRAM === "true") {
    try {
      console.log("[Pipeline] Bắt đầu gửi Telegram");
      results.telegram = {
        success: true,
        data: await sendVideoToTelegram({
          filePath: outputPath,
          caption: finalHook,
        }),
      };
      console.log("[Pipeline] Gửi Telegram xong");
    } catch (e: any) {
      console.error("[Pipeline] Gửi Telegram lỗi:", e);
      results.telegram = { success: false, error: e.message };
    }
  }

  return results;
}