import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { v4 as uuidv4 } from "uuid";

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function parseDataUrl(dataUrl: string) {
  const match = /^data:([^,]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error("Data URL không hợp lệ");

  return {
    mimeType: match[1],
    base64: match[2],
  };
}

function writeDataUrlToFile(dataUrl: string, outPath: string) {
  const parsed = parseDataUrl(dataUrl);
  fs.writeFileSync(outPath, Buffer.from(parsed.base64, "base64"));
  return parsed.mimeType;
}

function isRawPcmMime(mimeType: string) {
  return mimeType.toLowerCase().startsWith("audio/l16");
}

function extractSampleRate(mimeType: string): number {
  const match = /rate=(\d+)/i.exec(mimeType);
  return match ? Number(match[1]) : 24000;
}

function getAudioExt(mimeType: string) {
  const lower = mimeType.toLowerCase();
  if (lower.includes("mpeg") || lower.includes("mp3")) return "mp3";
  if (lower.includes("wav")) return "wav";
  if (lower.includes("ogg")) return "ogg";
  if (lower.startsWith("audio/l16")) return "pcm";
  return "bin";
}

function escapeDrawtext(text: string) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function wrapText(text: string, maxCharsPerLine = 26, maxLines = 3) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (test.length <= maxCharsPerLine) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) break;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  return lines.join("\n");
}

export async function renderVideoFromAssets(params: {
  imageDataUrls: string[];
  audioDataUrl: string;
  title: string;
}) {
  const tempDir = path.resolve("temp", uuidv4());
  const outputDir = path.resolve(process.env.OUTPUT_DIR || "./output");

  ensureDir(tempDir);
  ensureDir(outputDir);

  try {
    const templatePath = path.resolve("public", "effect", "news-temp.jpg");
    if (!fs.existsSync(templatePath)) {
      throw new Error("Thiếu file template: public/effect/news-temp.jpg");
    }

    if (!params.imageDataUrls?.length) {
      throw new Error("Không có ảnh để render video");
    }

    const mainImagePath = path.join(tempDir, "main.png");
    writeDataUrlToFile(params.imageDataUrls[0], mainImagePath);

    const audioMimeType = parseDataUrl(params.audioDataUrl).mimeType;
    const audioExt = getAudioExt(audioMimeType);
    const audioPath = path.join(tempDir, `voice.${audioExt}`);
    writeDataUrlToFile(params.audioDataUrl, audioPath);

    const outputPath = path.join(outputDir, `video-${Date.now()}.mp4`);
    const bgmPath = path.resolve("public", "effect", "newsmusic.mp3");
    const hasBgm = fs.existsSync(bgmPath);

    console.log("[videoRenderer] bgmPath:", bgmPath);
    console.log("[videoRenderer] hasBgm:", hasBgm);
    const wrappedTitle = wrapText(params.title || "Tin mới", 26, 3);
    const safeTitle = escapeDrawtext(wrappedTitle);

    await new Promise<void>((resolve, reject) => {
      const command = ffmpeg()
        .input(templatePath)
        .loop(30)
        .input(mainImagePath);

      // Input 2 = voice
      if (isRawPcmMime(audioMimeType)) {
        const sampleRate = extractSampleRate(audioMimeType);

        console.log("[videoRenderer] raw PCM sampleRate:", sampleRate);

        command
          .input(audioPath)
          .inputOptions([
            "-f s16le",
            `-ar ${sampleRate}`,
            "-ac 1",
          ]);
      } else {
        command.input(audioPath);
      }

      // Input 3 = bgm
      if (hasBgm) {
        command.input(bgmPath).inputOptions(["-stream_loop -1"]);
      }

      const filters: string[] = [
        "[1:v]scale=900:760:force_original_aspect_ratio=decrease[mainimg]",
        "[0:v][mainimg]overlay=90:180[tmp1]",        `[tmp1]drawtext=text='${safeTitle}':fontcolor=white:fontsize=42:x=70:y=1120:line_spacing=10:box=0:shadowcolor=black@0.5:shadowx=2:shadowy=2:fix_bounds=true[text1]`,
        "[text1]drawbox=x=60:y=1850:w=760:h=10:color=white@0.25:t=fill[barbg]",
        "[barbg]drawbox=x=60:y=1850:w='760*(t/25)':h=10:color=white@1:t=fill[bar1]",
        "[bar1]drawtext=text='%{eif\\:t\\:d}/25':fontcolor=white:fontsize=28:x=860:y=1828:shadowcolor=black@0.5:shadowx=2:shadowy=2[finalv]"
      ]

      if (hasBgm) {
        // voice nhỏ hơn 0 dB giữ nguyên, bgm giảm còn khoảng 10%
        filters.push("[2:a]volume=1.0[voice]");
        filters.push("[3:a]volume=0.20[bgm]");
        filters.push("[voice][bgm]amix=inputs=2:duration=first:dropout_transition=2[mixeda]");
      } else {
        filters.push("[2:a]volume=1.0[mixeda]");
      }

      command
        .complexFilter(filters)
        .outputOptions([
          "-map [finalv]",
          "-map [mixeda]",
          "-shortest",
          "-c:v libx264",
          "-preset veryfast",
          "-c:a aac",
          "-b:a 192k",
          "-pix_fmt yuv420p",
        ])
        .save(outputPath)
        .on("end", () => resolve())
        .on("error", (err) => reject(err));
    });

    return { outputPath };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}