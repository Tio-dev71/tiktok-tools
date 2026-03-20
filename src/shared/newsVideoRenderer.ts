export type RenderMediaItem = {
  base64: string;
  mimeType: string;
  startTime?: number;
  endTime?: number;
  duration?: number;
};

export type RenderPayload = {
  mediaSources: RenderMediaItem[];
  audioBase64: string;
  title: string;
  currentMaskUrl: string;
  fullScript: string;
  bgmBase64?: string | null;
  bgmVolume?: number;
};

const DEFAULT_BGM_URL = "/effect/newsmusic.mp3";

const enhanceImage = (img: HTMLImageElement): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;

  // Apply a combination of filters to make the image "pop" and look sharper
  // Contrast and Saturation boost helps with perceived sharpness
  ctx.filter = "contrast(1.1) saturate(1.05) brightness(1.02)";
  ctx.drawImage(img, 0, 0);

  // Reset filter for any subsequent operations
  ctx.filter = "none";

  return canvas;
};

const getThemeColor = (canvas: HTMLCanvasElement): string => {
  const ctx = canvas.getContext("2d")!;
  // Sample colors from the 4 corners and the center to get a representative color
  // We'll prioritize the corners as they are more likely to be "background"
  const samples = [
    ctx.getImageData(0, 0, 1, 1).data,
    ctx.getImageData(canvas.width - 1, 0, 1, 1).data,
    ctx.getImageData(0, canvas.height - 1, 1, 1).data,
    ctx.getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data,
  ];

  let r = 0,
    g = 0,
    b = 0;
  samples.forEach((s) => {
    r += s[0];
    g += s[1];
    b += s[2];
  });

  r = Math.floor(r / samples.length);
  g = Math.floor(g / samples.length);
  b = Math.floor(b / samples.length);

  return `rgb(${r}, ${g}, ${b})`;
};

export async function renderNewsVideoLocally(
  payload: RenderPayload,
): Promise<Blob> {
  const {
    mediaSources,
    audioBase64,
    title,
    currentMaskUrl,
    fullScript,
    bgmBase64,
    bgmVolume = 0.2,
  } = payload;

  return await new Promise<Blob>(async (resolve, reject) => {
    try {
      // 1. Prepare Audio
      const binaryString = window.atob(audioBase64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const audioContext = new (
        window.AudioContext || (window as any).webkitAudioContext
      )({ sampleRate: 24000 });
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      // Manual Buffer Creation from raw PCM 16-bit 24kHz
      const manualBuffer = audioContext.createBuffer(
        1,
        bytes.length / 2,
        24000,
      );
      const channelData = manualBuffer.getChannelData(0);
      const dataView = new DataView(bytes.buffer);
      for (let i = 0; i < bytes.length / 2; i++) {
        channelData[i] = dataView.getInt16(i * 2, true) / 32768;
      }

      const duration = manualBuffer.duration;
      if (isNaN(duration) || duration <= 0) {
        throw new Error("Invalid audio duration generated.");
      }

      // Load BGM
      let bgmBuffer: AudioBuffer | null = null;
      const bgmSourceUrl = bgmBase64 || DEFAULT_BGM_URL;

      if (bgmSourceUrl) {
        try {
          console.log(
            "Loading BGM from:",
            bgmBase64 ? "Custom Upload" : "Default URL",
          );
          const bgmResponse = await fetch(bgmSourceUrl);
          if (!bgmResponse.ok)
            throw new Error(`BGM fetch failed: ${bgmResponse.status}`);
          const bgmArrayBuffer = await bgmResponse.arrayBuffer();
          bgmBuffer = await audioContext.decodeAudioData(bgmArrayBuffer);
          console.log("BGM loaded successfully, duration:", bgmBuffer.duration);
        } catch (e) {
          console.warn("Failed to load BGM:", e);
        }
      }

      // 2. Prepare Canvas with 1080x1920 dimensions (9:16)
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1920;
      const ctx = canvas.getContext("2d")!;

      // Load Media Items
      const loadedMedia: {
        type: "image" | "video";
        element: HTMLCanvasElement | HTMLVideoElement;
        isVertical: boolean;
      }[] = [];
      for (const src of mediaSources) {
        if (src.mimeType.startsWith("video")) {
          const video = document.createElement("video");
          video.src = src.base64;
          video.muted = true;
          video.playsInline = true;
          video.crossOrigin = "anonymous";
          await new Promise((res) => {
            video.onloadeddata = res;
            video.onerror = () => res(null);
          });
          if (video.readyState >= 2) {
            loadedMedia.push({
              type: "video",
              element: video,
              isVertical: video.videoHeight > video.videoWidth,
            });
          }
        } else {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = src.base64;
          await new Promise((res) => {
            img.onload = res;
            img.onerror = () => res(null);
          });
          if (img.complete && img.naturalWidth > 0) {
            const enhanced = enhanceImage(img);
            loadedMedia.push({
              type: "image",
              element: enhanced,
              isVertical: img.naturalHeight > img.naturalWidth,
            });
          }
        }
      }

      if (loadedMedia.length === 0) {
        throw new Error("No valid media loaded");
      }

      const themeColor =
        loadedMedia[0].type === "image"
          ? getThemeColor(loadedMedia[0].element as HTMLCanvasElement)
          : "#000000";

      // Load Mask Image
      let maskImg: HTMLImageElement | null = null;
      if (currentMaskUrl) {
        maskImg = new Image();
        maskImg.crossOrigin = "anonymous";
        maskImg.src = currentMaskUrl;

        try {
          await new Promise((resolve, reject) => {
            maskImg!.onload = () => {
              console.log(
                "Mask loaded successfully:",
                maskImg!.naturalWidth,
                "x",
                maskImg!.naturalHeight,
              );
              resolve(true);
            };
            maskImg!.onerror = (err) => {
              console.error("Mask load error:", err);
              reject(err);
            };
            // Timeout after 10 seconds
            setTimeout(() => reject(new Error("Mask load timeout")), 10000);
          });
        } catch (err) {
          console.warn("Proceeding without mask due to load error:", err);
          maskImg = null;
        }
      }

      // 3. Setup Recording
      const stream = canvas.captureStream(30); // 30 FPS

      // Add Audio to Stream
      const audioDestination = audioContext.createMediaStreamDestination();

      // Voice-off (Main)
      const voiceSource = audioContext.createBufferSource();
      voiceSource.buffer = manualBuffer;
      voiceSource.connect(audioDestination);

      // BGM (Background)
      let bgmSource: AudioBufferSourceNode | null = null;
      if (bgmBuffer) {
        bgmSource = audioContext.createBufferSource();
        bgmSource.buffer = bgmBuffer;
        bgmSource.loop = true;

        const bgmGain = audioContext.createGain();
        bgmGain.gain.value = bgmVolume; // User defined volume

        bgmSource.connect(bgmGain);
        bgmGain.connect(audioDestination);
      }

      const audioTrack = audioDestination.stream.getAudioTracks()[0];
      if (audioTrack) {
        stream.addTrack(audioTrack);
      }

      // Draw Initial Frame before starting recorder
      ctx.fillStyle = themeColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Helper to render a single media item with its animation
      const renderSingleMedia = (
        index: number,
        progress: number,
        mediaElapsed: number,
      ) => {
        const item = loadedMedia[index];
        const startTime = mediaSources[index].startTime || 0;

        // Gentle zoom out effect: 1.1x down to 1.0x
        const zoomFactor = 1.1 - 0.1 * progress;

        let elementToDraw: CanvasImageSource;
        let sourceW, sourceH;

        if (item.type === "video") {
          const video = item.element as HTMLVideoElement;
          const endTime =
            mediaSources[index].endTime && mediaSources[index].endTime > 0
              ? mediaSources[index].endTime
              : video.duration;
          const trimDuration = Math.max(0.1, endTime - startTime);
          const expectedTime = startTime + (mediaElapsed % trimDuration);

          if (video.playbackRate !== 1.0) video.playbackRate = 1.0;
          const isStart = mediaElapsed < 0.1;
          const isOff = Math.abs(video.currentTime - expectedTime) > 0.5;

          if (!video.seeking && (isStart || isOff)) {
            try {
              video.currentTime = expectedTime;
            } catch (e) {
              console.warn("Seek video failed:", e);
            }
          }

          if (video.paused && !video.seeking) {
            video.play().catch(() => {});
          }
          elementToDraw = video;
          sourceW = video.videoWidth;
          sourceH = video.videoHeight;
        } else {
          const imgCanvas = item.element as HTMLCanvasElement;
          elementToDraw = imgCanvas;
          sourceW = imgCanvas.width;
          sourceH = imgCanvas.height;
        }

        if (index === 0) {
          // Contained logic for thumbnail (index 0)
          const TOP_MARGIN = 230;
          const SIDE_MARGIN = 50;
          const MAX_ZOOM = 1.1;

          let maskHeight = 0;
          if (maskImg && maskImg.complete && maskImg.naturalWidth > 0) {
            maskHeight =
              canvas.width * (maskImg.naturalHeight / maskImg.naturalWidth);
          }

          const newsAreaHeight = canvas.height - maskHeight - TOP_MARGIN;
          const visibleMaxDrawW = canvas.width - SIDE_MARGIN * 2;
          const visibleMaxDrawH = newsAreaHeight;
          const baseScale = Math.min(
            visibleMaxDrawW / (sourceW * MAX_ZOOM),
            visibleMaxDrawH / (sourceH * MAX_ZOOM)
          );

          const finalScale = baseScale * zoomFactor;
          const drawW = sourceW * finalScale;
          const drawH = sourceH * finalScale;
          const drawX = (canvas.width - drawW) / 2;
          const drawY = TOP_MARGIN + (newsAreaHeight - drawH) / 2;

          ctx.drawImage(elementToDraw, drawX, drawY, drawW, drawH);
        } else {
          const isLandscapeImage = item.type === "image" && sourceW > sourceH;

          if (isLandscapeImage) {
            // Ảnh ngang: giữ nguyên bố cục contain, không phóng full màn hình,
            // nhưng vẫn giữ effect zoom out nhẹ từ 1.1 -> 1.0
            const SIDE_MARGIN = 40;
            const TOP_BOTTOM_MARGIN = 40;
            const MAX_ZOOM = 1.1;

            const visibleMaxDrawW = canvas.width - SIDE_MARGIN * 2;
            const visibleMaxDrawH = canvas.height - TOP_BOTTOM_MARGIN * 2;
            const baseScale = Math.min(
              visibleMaxDrawW / (sourceW * MAX_ZOOM),
              visibleMaxDrawH / (sourceH * MAX_ZOOM),
            );

            const finalScale = baseScale * zoomFactor;
            const drawW = sourceW * finalScale;
            const drawH = sourceH * finalScale;
            const drawX = (canvas.width - drawW) / 2;
            const drawY = (canvas.height - drawH) / 2;

            ctx.drawImage(elementToDraw, drawX, drawY, drawW, drawH);
          } else {
            // Ảnh dọc / video: giữ logic cover như cũ
            const scaleW = canvas.width / sourceW;
            const scaleH = canvas.height / sourceH;
            const baseScale = Math.max(scaleW, scaleH);
            const finalScale = baseScale * zoomFactor;
            const drawW = sourceW * finalScale;
            const drawH = sourceH * finalScale;
            const drawX = (canvas.width - drawW) / 2;
            const drawY = (canvas.height - drawH) / 2;

            ctx.drawImage(elementToDraw, drawX, drawY, drawW, drawH);
          }
        }
      };

      // Helper to draw the media item with transitions
      const transitionDuration = 0.6;

      // Calculate durations for each sentence
      const sentences = fullScript
        .split(/[.!?]\s+/)
        .filter((s) => s.trim().length > 0);
      const firstItemDuration = 6; // Fixed 6 seconds for thumbnail/hook

      let itemDurations: number[] = [];
      if (sentences.length > 1) {
        const remainingDuration = Math.max(0.1, duration - firstItemDuration);
        const remainingSentences = sentences.slice(1);
        const remainingChars = remainingSentences.reduce(
          (acc, s) => acc + s.length,
          0,
        );

        itemDurations = [firstItemDuration];
        remainingSentences.forEach((s) => {
          itemDurations.push(
            (s.length / Math.max(1, remainingChars)) * remainingDuration,
          );
        });
      } else {
        itemDurations = [duration];
      }

      const itemStartTimes = itemDurations.reduce((acc, d, i) => {
        if (i === 0) return [0];
        acc.push(acc[i - 1] + itemDurations[i - 1]);
        return acc;
      }, [] as number[]);

      const getMediaInfo = (elapsed: number) => {
        if (loadedMedia.length === 1) {
          return {
            index: 0,
            progress: elapsed / duration,
            mediaElapsed: elapsed,
            isTransitioning: false,
            nextIndex: -1,
            transitionAlpha: 0,
          };
        }

        let index = 0;
        for (let i = 0; i < itemStartTimes.length; i++) {
          const start = itemStartTimes[i];
          const dur = itemDurations[i];
          if (elapsed >= start && elapsed < start + dur) {
            index = i;
            break;
          }
        }
        if (elapsed >= duration) index = loadedMedia.length - 1;

        // Ensure index is within bounds of loadedMedia
        index = Math.min(index, loadedMedia.length - 1);

        const itemStart = itemStartTimes[index];
        const itemDuration = itemDurations[index];
        const mediaElapsed = elapsed - itemStart;
        const progress = Math.min(mediaElapsed / itemDuration, 1);

        // Transition logic
        const isTransitioning =
          index < loadedMedia.length - 1 &&
          mediaElapsed > itemDuration - transitionDuration;
        const nextIndex = isTransitioning ? index + 1 : -1;
        const transitionAlpha = isTransitioning
          ? (mediaElapsed - (itemDuration - transitionDuration)) /
            transitionDuration
          : 0;

        return {
          index,
          progress,
          mediaElapsed,
          isTransitioning,
          nextIndex,
          transitionAlpha,
        };
      };

      // Use a compatible mimeType, fall back if needed
      const types = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
        "video/mp4",
        "video/quicktime",
      ];
      let mimeType = "";
      for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          break;
        }
      }

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 8000000, // High quality 8Mbps
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType || "video/webm" });
        if (blob.size === 0) {
          reject(new Error("Video generation failed: Empty recording."));
          return;
        }
        resolve(blob);
      };

      // 4. Start Animation and Recording
      let recordingStartTime: number | null = null;
      let animationFrameId: number;

      const animate = (now: number) => {
        if (recordingStartTime === null) recordingStartTime = now;
        try {
          const elapsed = (now - recordingStartTime) / 1000;

          // End recording precisely when voice duration is reached
          if (elapsed >= duration) {
            if (recorder.state !== "inactive") {
              recorder.stop();
            }
            try {
              voiceSource.stop();
            } catch (e) {}
            if (bgmSource) {
              try {
                bgmSource.stop();
              } catch (e) {}
            }
            cancelAnimationFrame(animationFrameId);
            return;
          }

          // Draw Background (Theme Color)
          ctx.fillStyle = themeColor;
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          const info = getMediaInfo(elapsed);

          // Pause inactive videos
          loadedMedia.forEach((m, i) => {
            if (
              m.type === "video" &&
              i !== info.index &&
              i !== info.nextIndex
            ) {
              const v = m.element as HTMLVideoElement;
              if (!v.paused) v.pause();
            }
          });

          if (info.isTransitioning) {
            ctx.globalAlpha = 1 - info.transitionAlpha;
            renderSingleMedia(info.index, info.progress, info.mediaElapsed);
            ctx.globalAlpha = info.transitionAlpha;
            renderSingleMedia(info.nextIndex, 0, 0);
            ctx.globalAlpha = 1.0;
          } else {
            renderSingleMedia(info.index, info.progress, info.mediaElapsed);
          }

          // Draw Mask and Title only during first media (index 0)
          if (info.index === 0) {
            const alpha = info.isTransitioning ? 1 - info.transitionAlpha : 1;
            ctx.globalAlpha = alpha;

            // Draw Mask at the bottom
            if (maskImg && maskImg.complete && maskImg.naturalWidth > 0) {
              const maskHeight =
                canvas.width * (maskImg.naturalHeight / maskImg.naturalWidth);
              ctx.drawImage(
                maskImg,
                0,
                canvas.height - maskHeight,
                canvas.width,
                maskHeight,
              );
            }

            // Draw Title Text
            if (title) {
              const upperTitle = title.toUpperCase();
              ctx.save();

              ctx.font = "900 45px 'Inter', 'sans-serif'";
              ctx.textAlign = "left";
              ctx.textBaseline = "top";

              const margin = 130;
              const textX = margin;
              const textY = canvas.height - 620;

              const maxWidth = canvas.width - margin * 2;
              const lineHeight = 55;

              const words = upperTitle.split(" ");
              let line = "";
              const lines = [];

              for (let n = 0; n < words.length; n++) {
                const testLine = line + words[n] + " ";
                const metrics = ctx.measureText(testLine);
                const testWidth = metrics.width;
                if (testWidth > maxWidth && n > 0) {
                  lines.push(line);
                  line = words[n] + " ";
                } else {
                  line = testLine;
                }
              }
              lines.push(line);

              lines.forEach((l, lineIndex) => {
                const currentY = textY + lineIndex * lineHeight;
                const lineWords = l.trim().split(" ");
                let currentX = textX;

                lineWords.forEach((word, wordIndex) => {
                  const globalWordIndex =
                    lines
                      .slice(0, lineIndex)
                      .reduce(
                        (acc, curr) => acc + curr.trim().split(" ").length,
                        0,
                      ) + wordIndex;
                  const isShocking = globalWordIndex < 3;

                  ctx.strokeStyle = "#011f50";
                  ctx.lineWidth = 8;
                  ctx.strokeText(word, currentX, currentY);

                  ctx.fillStyle = isShocking ? "#ff940a" : "white";
                  ctx.fillText(word, currentX, currentY);

                  currentX += ctx.measureText(word + " ").width;
                });
              });
              ctx.restore();
            }
            ctx.globalAlpha = 1.0;
          }

          animationFrameId = requestAnimationFrame(animate);
        } catch (err) {
          console.error("Animation error:", err);
          if (recorder.state !== "inactive") recorder.stop();
          try {
            voiceSource.stop();
          } catch (e) {}
          if (bgmSource) {
            try {
              bgmSource.stop();
            } catch (e) {}
          }
        }
      };

      // Small delay to ensure everything is ready
      // Render trước frame đầu tiên
      const firstInfo = getMediaInfo(0);

      // Nếu media đầu là video thì ép nó nhảy đúng thời điểm đầu
      const firstItem = loadedMedia[firstInfo.index];
      if (firstItem?.type === "video") {
        const firstVideo = firstItem.element as HTMLVideoElement;
        const startTime = mediaSources[firstInfo.index].startTime || 0;

        await new Promise<void>((resolve) => {
          const done = () => resolve();

          const seekHandler = () => {
            firstVideo.removeEventListener("seeked", seekHandler);
            done();
          };

          firstVideo.addEventListener("seeked", seekHandler);
          try {
            firstVideo.currentTime = startTime;
          } catch {
            firstVideo.removeEventListener("seeked", seekHandler);
            resolve();
          }

          setTimeout(() => {
            firstVideo.removeEventListener("seeked", seekHandler);
            resolve();
          }, 500);
        });
      }

      // Vẽ sẵn 1 frame hoàn chỉnh trước khi record
      ctx.fillStyle = themeColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      renderSingleMedia(
        firstInfo.index,
        firstInfo.progress,
        firstInfo.mediaElapsed,
      );

      // Draw Mask + Title nếu đang là media đầu
      if (firstInfo.index === 0) {
        if (maskImg && maskImg.complete && maskImg.naturalWidth > 0) {
          const maskHeight =
            canvas.width * (maskImg.naturalHeight / maskImg.naturalWidth);
          ctx.drawImage(
            maskImg,
            0,
            canvas.height - maskHeight,
            canvas.width,
            maskHeight,
          );
        }

        if (title) {
          const upperTitle = title.toUpperCase();
          ctx.save();

          ctx.font = "900 45px 'Inter', 'sans-serif'";
          ctx.textAlign = "left";
          ctx.textBaseline = "top";

          const margin = 130;
          const textX = margin;
          const textY = canvas.height - 620;
          const maxWidth = canvas.width - margin * 2;
          const lineHeight = 55;

          const words = upperTitle.split(" ");
          let line = "";
          const lines: string[] = [];

          for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + " ";
            const metrics = ctx.measureText(testLine);
            const testWidth = metrics.width;
            if (testWidth > maxWidth && n > 0) {
              lines.push(line);
              line = words[n] + " ";
            } else {
              line = testLine;
            }
          }
          lines.push(line);

          lines.forEach((l, lineIndex) => {
            const currentY = textY + lineIndex * lineHeight;
            const lineWords = l.trim().split(" ");
            let currentX = textX;

            lineWords.forEach((word, wordIndex) => {
              const globalWordIndex =
                lines
                  .slice(0, lineIndex)
                  .reduce(
                    (acc, curr) => acc + curr.trim().split(" ").length,
                    0,
                  ) + wordIndex;

              const isShocking = globalWordIndex < 3;

              ctx.strokeStyle = "#011f50";
              ctx.lineWidth = 8;
              ctx.strokeText(word, currentX, currentY);

              ctx.fillStyle = isShocking ? "#ff940a" : "white";
              ctx.fillText(word, currentX, currentY);

              currentX += ctx.measureText(word + " ").width;
            });
          });

          ctx.restore();
        }
      }

      // Chờ browser commit frame đầu tiên
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );

      // Bắt đầu record sau khi frame đầu đã có
      recorder.start();
      voiceSource.start();
      if (bgmSource) bgmSource.start();
      animationFrameId = requestAnimationFrame(animate);
    } catch (e) {
      reject(e);
    }
  });
}
