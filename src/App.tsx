/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GeminiService } from './services/geminiService';
import { 
  Upload, 
  Type, 
  Video, 
  Play,
  Pause,
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  FileText,
  Volume2,
  RefreshCw,
  Key,
  Share2,
  UserCheck,
  Send,
  Music,
  Download,
  Copy,
  Trash2,
  Edit,
  GripVertical
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const DEFAULT_MASK_URL = '/api/proxy-drive?id=1muS1qYePYXJcd1QzbldZQ1NGoBGoLacY';
const DEFAULT_BGM_URL = '/api/proxy-drive?id=1D-8X5XmsUJX1f55rQy78etlR7093mckd';

export default function App() {
  const [content, setContent] = useState('');
  const [mediaItems, setMediaItems] = useState<{ 
    base64: string; 
    mimeType: string;
    startTime?: number;
    endTime?: number;
    duration?: number;
  }[]>([]);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<'idle' | 'scripting' | 'audio' | 'video' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  
  const [script, setScript] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState('');
  const [maskUrl, setMaskUrl] = useState(DEFAULT_MASK_URL);
  
  const [customBgm, setCustomBgm] = useState<{ base64: string; mimeType: string } | null>(null);
  const [bgmFileName, setBgmFileName] = useState<string | null>("Nhạc nền mặc định (Google Drive)");
  const [bgmVolume, setBgmVolume] = useState(0.2);

  const [tiktokToken, setTiktokToken] = useState<any>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  
  const [hasApiKey, setHasApiKey] = useState(false);
  const [isTrimming, setIsTrimming] = useState(false);
  const [playingMediaIndex, setPlayingMediaIndex] = useState<number | null>(null);
  
  const hoveredMediaIndexRef = useRef<number | null>(null);
  const dragItemIndexRef = useRef<number | null>(null);
  const dragOverItemIndexRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    checkApiKey();
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const isImage = items[i].type.indexOf('image') !== -1;
          const isVideo = items[i].type.indexOf('video') !== -1;
          if (isImage || isVideo) {
            const blob = items[i].getAsFile();
            if (blob) {
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64 = reader.result as string;
                const hoveredIndex = hoveredMediaIndexRef.current;
                
                setMediaItems(prev => {
                  const newItem = { 
                    base64, 
                    mimeType: blob.type,
                    startTime: 0,
                    endTime: 0,
                    duration: 0
                  };

                  if (blob.type.startsWith('video')) {
                    const v = document.createElement('video');
                    v.src = base64;
                    v.onloadedmetadata = () => {
                      newItem.duration = v.duration;
                      newItem.endTime = v.duration;
                      setMediaItems(current => {
                        const updated = [...current];
                        const idx = hoveredIndex !== null ? hoveredIndex : current.length - 1;
                        if (updated[idx]) {
                          updated[idx].duration = v.duration;
                          updated[idx].endTime = v.duration;
                        }
                        return updated;
                      });
                    };
                  }

                  if (hoveredIndex !== null && hoveredIndex >= 0 && hoveredIndex < prev.length) {
                    const next = [...prev];
                    next[hoveredIndex] = newItem;
                    return next;
                  }
                  return [...prev, newItem];
                });
              };
              reader.readAsDataURL(blob);
            }
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'TIKTOK_AUTH_SUCCESS') {
        setTiktokToken(event.data.data);
      }
    };
    window.addEventListener('message', handleMessage);
    
    return () => {
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const checkApiKey = async () => {
    if (process.env?.GEMINI_API_KEY) {
      setHasApiKey(true);
      return;
    }

    if (window.aistudio) {
      const selected = await window.aistudio.hasSelectedApiKey();
      setHasApiKey(selected);
    }
  };

  const handleOpenKeySelector = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    } else {
      alert("Bạn đang chạy local. Hãy set GEMINI_API_KEY trong file .env");
    }
  };

  const handleConnectTikTok = async () => {
    try {
      const response = await fetch('/api/auth/tiktok/url');
      const data = await response.json();

      if (!response.ok || !data.url) {
        throw new Error(data.error || "Missing url");
      }

      window.open(data.url, 'tiktok_auth', 'width=600,height=700');
    } catch (err) {
      console.error(err);
      setError("Không thể kết nối với TikTok. Kiểm tra APP_URL / TIKTOK_CLIENT_KEY.");
    }
  };

  const handleUploadToTikTok = async (forcedUrl?: string) => {
    const targetUrl = forcedUrl || videoUrl;
    if (!targetUrl || !tiktokToken) return;
    setIsUploading(true);
    setUploadSuccess(false);
    try {
      const response = await fetch(targetUrl);
      const blob = await response.blob();
      
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(blob);
      });
      const videoBase64 = await base64Promise;

      const uploadResponse = await fetch('/api/tiktok/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoBase64,
          accessToken: tiktokToken.access_token,
          openId: tiktokToken.open_id
        })
      });
      
      const result = await uploadResponse.json();
      if (result.success) {
        setUploadSuccess(true);
      } else {
        throw new Error(result.error || "Lỗi không xác định khi tải lên TikTok");
      }
    } catch (err: any) {
      console.error("TikTok upload error:", err);
      setError(`Lỗi đăng TikTok: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleCopyTitle = () => {
    if (videoTitle) {
      navigator.clipboard.writeText(videoTitle);
    }
  };

  const handleMediaUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result as string;
          const newItem = { 
            base64, 
            mimeType: file.type,
            startTime: 0,
            endTime: 0,
            duration: 0
          };

          if (file.type.startsWith('video')) {
            const v = document.createElement('video');
            v.src = base64;
            v.onloadedmetadata = () => {
              setMediaItems(current => {
                return current.map(item => {
                  if (item.base64 === base64) {
                    return { ...item, duration: v.duration, endTime: v.duration };
                  }
                  return item;
                });
              });
            };
          }
          setMediaItems(prev => [...prev, newItem]);
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const removeMediaItem = (index: number) => {
    setMediaItems(prev => prev.filter((_, i) => i !== index));
  };

  const replaceMediaItem = (index: number) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result as string;
          const newItem = { 
            base64, 
            mimeType: file.type,
            startTime: 0,
            endTime: 0,
            duration: 0
          };

          if (file.type.startsWith('video')) {
            const v = document.createElement('video');
            v.src = base64;
            v.onloadedmetadata = () => {
              setMediaItems(current => {
                const next = [...current];
                if (next[index]) {
                  next[index].duration = v.duration;
                  next[index].endTime = v.duration;
                }
                return next;
              });
            };
          }

          setMediaItems(prev => {
            const next = [...prev];
            next[index] = newItem;
            return next;
          });
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  const updateMediaTrim = (index: number, startTime: number, endTime: number) => {
    setMediaItems(prev => {
      const next = [...prev];
      if (next[index]) {
        // Ensure startTime doesn't exceed endTime and vice versa
        const validStart = Math.min(startTime, endTime);
        const validEnd = Math.max(startTime, endTime);
        next[index] = { ...next[index], startTime: validStart, endTime: validEnd };
        
        // Seek the video preview if it exists
        const v = document.getElementById(`video-preview-${index}`) as HTMLVideoElement;
        if (v) {
          v.currentTime = validStart;
        }
      }
      return next;
    });
  };

  const handleDragStart = (index: number) => {
    dragItemIndexRef.current = index;
  };

  const handleDragEnter = (index: number) => {
    dragOverItemIndexRef.current = index;
  };

  const handleDragEnd = () => {
    if (dragItemIndexRef.current !== null && dragOverItemIndexRef.current !== null) {
      const nextItems = [...mediaItems];
      const draggedItem = nextItems.splice(dragItemIndexRef.current, 1)[0];
      nextItems.splice(dragOverItemIndexRef.current, 0, draggedItem);
      setMediaItems(nextItems);
    }
    dragItemIndexRef.current = null;
    dragOverItemIndexRef.current = null;
  };

  const handleBgmUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setCustomBgm({ base64, mimeType: file.type });
        setBgmFileName(file.name);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleProcess = async () => {
    if (!content || mediaItems.length === 0) return;
    
    setIsProcessing(true);
    setError(null);
    setScript(null);
    setAudioUrl(null);
    setVideoUrl(null);

    try {
      const gemini = new GeminiService();

      // Step 1: Generate Script
      setStatus('scripting');
      const generatedScript = await gemini.generateScript(content);
      setScript(generatedScript);

      // Auto-generate sensational title
      const generatedTitle = await gemini.generateTitle(generatedScript);
      setVideoTitle(generatedTitle);

      // Step 2: Generate Audio
      setStatus('audio');
      const audioBase64 = await gemini.generateAudio(generatedScript);
      
      // Step 3: Generate Video Locally (No Veo needed)
      setStatus('video');
      const generatedVideoUrl = await generateVideoLocally(mediaItems, audioBase64, generatedTitle, maskUrl);
      setVideoUrl(generatedVideoUrl);
      setAudioUrl(`data:audio/wav;base64,${audioBase64}`);

      setStatus('done');

      // Auto-upload to TikTok if connected
      if (tiktokToken) {
        handleUploadToTikTok(generatedVideoUrl);
      }
    } catch (err: any) {
      console.error(err);
      const errStr = JSON.stringify(err);
      let errorMessage = err.message || 'Đã xảy ra lỗi trong quá trình xử lý.';
      
      const isPermissionDenied = errorMessage.includes('PERMISSION_DENIED') || errorMessage.includes('403') || errStr.includes('PERMISSION_DENIED') || errStr.includes('403');
      const isRateLimited = errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('429') || errStr.includes('RESOURCE_EXHAUSTED') || errStr.includes('429');

      if (isPermissionDenied) {
        errorMessage = 'API Key hiện tại không có quyền truy cập vào mô hình Veo (Tạo Video). \n\nĐiều này thường xảy ra nếu:\n1. Bạn đang dùng API Key miễn phí (Free tier).\n2. Dự án Google Cloud của bạn chưa bật thanh toán (Billing).\n3. Bạn chưa bật "Generative Language API" trong Google Cloud Console.';
      } else if (isRateLimited) {
        errorMessage = 'Bạn đã hết hạn mức (Quota) sử dụng Gemini API. \n\nCách khắc phục:\n1. Nếu đang dùng bản miễn phí: Vui lòng đợi một lát rồi thử lại (giới hạn theo phút).\n2. Nếu đang dùng bản trả phí: Kiểm tra lại thông tin thanh toán (Billing) trên Google Cloud Console.\n3. Nâng cấp lên gói trả phí (Pay-as-you-go) để tăng hạn mức.';
      }
      
      setError(errorMessage);
      setStatus('error');
    } finally {
      setIsProcessing(false);
    }
  };

  const enhanceImage = (img: HTMLImageElement): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    // Apply a combination of filters to make the image "pop" and look sharper
    // Contrast and Saturation boost helps with perceived sharpness
    ctx.filter = 'contrast(1.1) saturate(1.05) brightness(1.02)';
    ctx.drawImage(img, 0, 0);
    
    // Reset filter for any subsequent operations
    ctx.filter = 'none';
    
    return canvas;
  };

  const getThemeColor = (canvas: HTMLCanvasElement): string => {
    const ctx = canvas.getContext('2d')!;
    // Sample colors from the 4 corners and the center to get a representative color
    // We'll prioritize the corners as they are more likely to be "background"
    const samples = [
      ctx.getImageData(0, 0, 1, 1).data,
      ctx.getImageData(canvas.width - 1, 0, 1, 1).data,
      ctx.getImageData(0, canvas.height - 1, 1, 1).data,
      ctx.getImageData(canvas.width - 1, canvas.height - 1, 1, 1).data,
    ];

    let r = 0, g = 0, b = 0;
    samples.forEach(s => {
      r += s[0];
      g += s[1];
      b += s[2];
    });

    r = Math.floor(r / samples.length);
    g = Math.floor(g / samples.length);
    b = Math.floor(b / samples.length);

    return `rgb(${r}, ${g}, ${b})`;
  };

  const generateVideoLocally = async (mediaSources: { 
    base64: string; 
    mimeType: string;
    startTime?: number;
    endTime?: number;
    duration?: number;
  }[], audioBase64: string, title: string, currentMaskUrl: string): Promise<string> => {
    return new Promise(async (resolve, reject) => {
      try {
        // 1. Prepare Audio
        const binaryString = window.atob(audioBase64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }
        
        // Manual Buffer Creation from raw PCM 16-bit 24kHz
        const manualBuffer = audioContext.createBuffer(1, bytes.length / 2, 24000);
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
        const bgmSourceUrl = customBgm ? customBgm.base64 : DEFAULT_BGM_URL;
        
        if (bgmSourceUrl) {
          try {
            console.log("Loading BGM from:", customBgm ? "Custom Upload" : "Default URL");
            const bgmResponse = await fetch(bgmSourceUrl);
            if (!bgmResponse.ok) throw new Error(`BGM fetch failed: ${bgmResponse.status}`);
            const bgmArrayBuffer = await bgmResponse.arrayBuffer();
            bgmBuffer = await audioContext.decodeAudioData(bgmArrayBuffer);
            console.log("BGM loaded successfully, duration:", bgmBuffer.duration);
          } catch (e) {
            console.warn("Failed to load BGM:", e);
          }
        }

        // 2. Prepare Canvas with 1080x1920 dimensions (9:16)
        const canvas = document.createElement('canvas');
        canvas.width = 1080;
        canvas.height = 1920;
        const ctx = canvas.getContext('2d')!;

        // Load Media Items
        const loadedMedia: { type: 'image' | 'video', element: HTMLCanvasElement | HTMLVideoElement, isVertical: boolean }[] = [];
        for (const src of mediaSources) {
          if (src.mimeType.startsWith('video')) {
            const video = document.createElement('video');
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
                type: 'video',
                element: video,
                isVertical: video.videoHeight > video.videoWidth
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
                type: 'image',
                element: enhanced,
                isVertical: img.naturalHeight > img.naturalWidth
              });
            }
          }
        }

        if (loadedMedia.length === 0) {
          throw new Error("No valid media loaded");
        }

        const themeColor = loadedMedia[0].type === 'image' 
          ? getThemeColor(loadedMedia[0].element as HTMLCanvasElement)
          : '#000000';

        // Load Mask Image
        let maskImg: HTMLImageElement | null = null;
        if (currentMaskUrl) {
          maskImg = new Image();
          maskImg.crossOrigin = "anonymous";
          maskImg.src = currentMaskUrl;
          
          try {
            await new Promise((resolve, reject) => {
              maskImg!.onload = () => {
                console.log("Mask loaded successfully:", maskImg!.naturalWidth, "x", maskImg!.naturalHeight);
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
        const renderSingleMedia = (index: number, progress: number, mediaElapsed: number) => {
          const item = loadedMedia[index];
          const isVertical = item.isVertical;
          const startTime = mediaSources[index].startTime || 0;
          
          const TOP_MARGIN = 230;
          const SIDE_MARGIN = 40;
          let maskHeight = 0;
          if (maskImg && maskImg.complete && maskImg.naturalWidth > 0) {
            maskHeight = canvas.width * (maskImg.naturalHeight / maskImg.naturalWidth);
          }

          const newsAreaHeight = canvas.height - maskHeight - TOP_MARGIN;
          const maxDrawW = canvas.width - (SIDE_MARGIN * 2);
          const maxDrawH = newsAreaHeight;
          
          let drawW, drawH, drawX, drawY;
          let elementToDraw: CanvasImageSource;

          if (item.type === 'video') {
            const video = item.element as HTMLVideoElement;
            const endTime = (mediaSources[index].endTime && mediaSources[index].endTime > 0) ? mediaSources[index].endTime : video.duration;
            const trimDuration = Math.max(0.1, endTime - startTime);
            
            const expectedTime = startTime + (mediaElapsed % trimDuration);
            
            // Ensure playback rate is normal
            if (video.playbackRate !== 1.0) video.playbackRate = 1.0;

            // Sync logic: Only seek if significantly off or at the very start of the slot
            // Avoid seeking if already seeking to prevent "seeking loops"
            const isStart = mediaElapsed < 0.1;
            const isOff = Math.abs(video.currentTime - expectedTime) > 0.5;
            
            if (!video.seeking && (isStart || isOff)) {
              video.currentTime = expectedTime;
            }

            if (video.paused && !video.seeking) {
              video.play().catch(() => {});
            }

            elementToDraw = video;
            const baseScale = Math.min(maxDrawW / video.videoWidth, maxDrawH / video.videoHeight);
            drawW = video.videoWidth * baseScale;
            drawH = video.videoHeight * baseScale;
          } else {
            const imgCanvas = item.element as HTMLCanvasElement;
            elementToDraw = imgCanvas;
            const baseScale = Math.min(maxDrawW / imgCanvas.width, maxDrawH / imgCanvas.height);
            
            if (isVertical) {
              // Slide effect for vertical images: Start at +100px (down) and move to -100px (up)
              const yShift = 100 - (200 * progress);
              drawW = imgCanvas.width * baseScale;
              drawH = imgCanvas.height * baseScale;
              drawX = (canvas.width - drawW) / 2;
              drawY = (TOP_MARGIN + (newsAreaHeight - drawH) / 2) + yShift;
              ctx.drawImage(elementToDraw, drawX, drawY, drawW, drawH);
              return;
            } else {
              // Zoom effect for horizontal images: 90% (0.9) to 100% (1.0)
              const zoomFactor = 0.9 + (0.1 * progress);
              const currentScale = baseScale * zoomFactor;
              drawW = imgCanvas.width * currentScale;
              drawH = imgCanvas.height * currentScale;
            }
          }

          drawX = (canvas.width - drawW) / 2;
          drawY = TOP_MARGIN + (newsAreaHeight - drawH) / 2;
          ctx.drawImage(elementToDraw, drawX, drawY, drawW, drawH);
        };

        // Helper to draw the media item with transitions
        const drawMedia = (elapsed: number) => {
          const mediaCount = loadedMedia.length;
          const durationPerMedia = duration / mediaCount;
          const transitionDuration = 0.6; // 0.6s cross-fade

          const mediaIndex = Math.min(Math.floor(elapsed / durationPerMedia), mediaCount - 1);
          const mediaElapsed = elapsed % durationPerMedia;
          const currentProgress = Math.min(mediaElapsed / durationPerMedia, 1);

          // Check if we are in a transition window to the next media
          const isTransitioning = mediaIndex < mediaCount - 1 && mediaElapsed > (durationPerMedia - transitionDuration);
          const nextIndex = isTransitioning ? mediaIndex + 1 : -1;

          // Pause inactive videos
          loadedMedia.forEach((m, i) => {
            if (m.type === 'video' && i !== mediaIndex && i !== nextIndex) {
              const v = m.element as HTMLVideoElement;
              if (!v.paused) v.pause();
            }
          });

          if (isTransitioning) {
            const transitionAlpha = (mediaElapsed - (durationPerMedia - transitionDuration)) / transitionDuration;

            // Draw current media fading out
            ctx.globalAlpha = 1 - transitionAlpha;
            renderSingleMedia(mediaIndex, currentProgress, mediaElapsed);

            // Draw next media fading in
            ctx.globalAlpha = transitionAlpha;
            const nextProgress = (mediaElapsed - (durationPerMedia - transitionDuration)) / durationPerMedia;
            renderSingleMedia(nextIndex, nextProgress, 0);

            ctx.globalAlpha = 1.0;
          } else {
            renderSingleMedia(mediaIndex, currentProgress, mediaElapsed);
          }
        };

        drawMedia(0);

        // Use a compatible mimeType, fall back if needed
        const types = [
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm',
          'video/mp4',
          'video/quicktime'
        ];
        let mimeType = '';
        for (const type of types) {
          if (MediaRecorder.isTypeSupported(type)) {
            mimeType = type;
            break;
          }
        }

        const recorder = new MediaRecorder(stream, { 
          mimeType,
          videoBitsPerSecond: 8000000 // High quality 8Mbps
        });
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunks.push(e.data);
          }
        };
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
          if (blob.size === 0) {
            reject(new Error("Video generation failed: Empty recording."));
            return;
          }
          resolve(URL.createObjectURL(blob));
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
              if (recorder.state !== 'inactive') {
                recorder.stop();
              }
              try { voiceSource.stop(); } catch(e) {}
              if (bgmSource) {
                try { bgmSource.stop(); } catch(e) {}
              }
              cancelAnimationFrame(animationFrameId);
              return;
            }

            // Draw Background (Theme Color)
            ctx.fillStyle = themeColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            drawMedia(elapsed);

            // Draw Mask at the bottom
            if (maskImg && maskImg.complete && maskImg.naturalWidth > 0) {
              const maskHeight = canvas.width * (maskImg.naturalHeight / maskImg.naturalWidth);
              ctx.drawImage(maskImg, 0, canvas.height - maskHeight, canvas.width, maskHeight);
            }

            // Draw Title Text
            if (title) {
              const upperTitle = title.toUpperCase();
              ctx.save();
              // Font: Extra Bold
              ctx.font = "900 45px 'Inter', 'sans-serif'";
              ctx.textAlign = "left";
              ctx.textBaseline = "top";
              
              const margin = 130;
              const textX = margin;
              // Moved up by another 15px (from 605 to 620)
              const textY = canvas.height - 620; 
              
              const maxWidth = canvas.width - (margin * 2); 
              const lineHeight = 55;

              const words = upperTitle.split(' ');
              let line = '';
              const lines = [];

              for (let n = 0; n < words.length; n++) {
                const testLine = line + words[n] + ' ';
                const metrics = ctx.measureText(testLine);
                const testWidth = metrics.width;
                if (testWidth > maxWidth && n > 0) {
                  lines.push(line);
                  line = words[n] + ' ';
                } else {
                  line = testLine;
                }
              }
              lines.push(line);

              const startY = textY; 

              lines.forEach((l, lineIndex) => {
                const currentY = startY + (lineIndex * lineHeight);
                const lineWords = l.trim().split(' ');
                let currentX = textX;

                lineWords.forEach((word, wordIndex) => {
                  // Track global word index
                  const globalWordIndex = lines.slice(0, lineIndex).reduce((acc, curr) => acc + curr.trim().split(' ').length, 0) + wordIndex;
                  
                  // Always color first 3 words orange for emphasis
                  const isShocking = globalWordIndex < 3;
                  
                  ctx.strokeStyle = "#011f50"; // Blue stroke for all
                  ctx.lineWidth = 8;
                  ctx.strokeText(word, currentX, currentY);
                  
                  ctx.fillStyle = isShocking ? "#ff940a" : "white"; // Orange for emphasis, white for rest
                  ctx.fillText(word, currentX, currentY);
                  
                  // Move X for next word
                  currentX += ctx.measureText(word + ' ').width;
                });
              });
              ctx.restore();
            }
            
            animationFrameId = requestAnimationFrame(animate);
          } catch (err) {
            console.error("Animation error:", err);
            if (recorder.state !== 'inactive') recorder.stop();
            try { voiceSource.stop(); } catch(e) {}
            if (bgmSource) {
              try { bgmSource.stop(); } catch(e) {}
            }
          }
        };

        // Small delay to ensure everything is ready
        setTimeout(() => {
          recorder.start();
          voiceSource.start();
          if (bgmSource) bgmSource.start();
          animationFrameId = requestAnimationFrame(animate);
        }, 100);
      } catch (e) {
        reject(e);
      }
    });
  };

  // Helper to create a minimal WAV header for raw PCM
  const createWavHeader = (dataLength: number, sampleRate: number) => {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    view.setUint32(0, 0x46464952, true); // "RIFF"
    view.setUint32(4, 36 + dataLength, true);
    view.setUint32(8, 0x45564157, true); // "WAVE"
    view.setUint32(12, 0x20746d66, true); // "fmt "
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(36, 0x61746164, true); // "data"
    view.setUint32(40, dataLength, true);
    return new Uint8Array(header);
  };

  const playAll = () => {
    if (videoRef.current) videoRef.current.play();
    if (audioUrl) playGeminiAudio(audioUrl);
  };

  // Helper to play PCM audio from Gemini
  const playGeminiAudio = async (base64: string) => {
    try {
      const binaryString = window.atob(base64.split(',')[1] || base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const audioBuffer = audioContext.createBuffer(1, bytes.length / 2, 24000);
      const nowBuffering = audioBuffer.getChannelData(0);
      
      // Convert 16-bit PCM to float
      const dataView = new DataView(bytes.buffer);
      for (let i = 0; i < bytes.length / 2; i++) {
        nowBuffering[i] = dataView.getInt16(i * 2, true) / 32768;
      }
      
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start();
    } catch (e) {
      console.error("Audio playback error", e);
    }
  };

  if (!hasApiKey) {
    return (
      <div className="min-h-screen bg-[#f5f2ed] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center border border-black/5">
          <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Key className="text-white w-8 h-8" />
          </div>
          <h1 className="text-2xl font-serif font-medium mb-4">Cần thiết lập API Key</h1>
          <p className="text-stone-600 mb-8 leading-relaxed">
            Để sử dụng tính năng giọng đọc AI, bạn cần chọn một API Key từ dự án Google Cloud có trả phí.
          </p>
          <button
            onClick={handleOpenKeySelector}
            className="w-full bg-black text-white py-4 rounded-2xl font-medium hover:bg-stone-800 transition-colors flex items-center justify-center gap-2"
          >
            Chọn API Key
          </button>
          <p className="mt-4 text-xs text-stone-400">
            Xem thêm về <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="underline">tài liệu thanh toán</a>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f2ed] text-[#1a1a1a] font-sans selection:bg-black selection:text-white">
      {/* Header */}
      <header className="border-b border-black/10 bg-white/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1224px] mx-auto px-6 h-20 flex items-center justify-between relative">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center">
              <Video className="text-white w-5 h-5" />
            </div>
            <h1 className="text-xl font-serif font-semibold tracking-tight hidden sm:block">News Video Creator</h1>
          </div>

          {/* Centered Action Buttons - Fixed position as originally requested */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center gap-4">
            <button
              onClick={handleProcess}
              disabled={isProcessing || !content || mediaItems.length === 0}
              className={cn(
                "px-5 py-2.5 rounded-xl font-sans text-sm font-medium transition-all flex items-center gap-2 shadow-lg",
                isProcessing || !content || mediaItems.length === 0 
                  ? "bg-stone-200 text-stone-400 cursor-not-allowed shadow-none" 
                  : "bg-black text-white hover:scale-105 active:scale-95 shadow-black/10"
              )}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Đang xử lý...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>Tạo Video</span>
                </>
              )}
            </button>

            <button 
              onClick={handleCopyTitle}
              disabled={status !== 'done' || !videoTitle}
              className={cn(
                "px-5 py-2.5 rounded-xl font-sans text-sm font-medium transition-all flex items-center gap-2 shadow-lg border border-black/10",
                status !== 'done' || !videoTitle
                  ? "bg-stone-100 text-stone-300 cursor-not-allowed shadow-none"
                  : "bg-white text-black hover:scale-105 active:scale-95 hover:bg-stone-50 shadow-black/5"
              )}
            >
              <Copy className="w-4 h-4" /> <span>Copy Tiêu đề</span>
            </button>

            {status === 'done' && videoUrl ? (
              <a 
                href={videoUrl} 
                download="news-video.mp4"
                className="px-5 py-2.5 bg-white border border-black/10 text-black rounded-xl text-sm font-medium hover:scale-105 active:scale-95 hover:bg-stone-50 transition-all flex items-center gap-2 shadow-lg shadow-black/5"
              >
                <Download className="w-4 h-4" /> <span>Tải về</span>
              </a>
            ) : (
              <button 
                disabled
                className="px-5 py-2.5 bg-stone-100 border border-black/10 text-stone-300 rounded-xl text-sm font-medium cursor-not-allowed flex items-center gap-2"
              >
                <Download className="w-4 h-4" /> <span>Tải về</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-6">
            <button 
              onClick={() => window.location.reload()}
              className={cn(
                "text-sm font-medium flex items-center gap-2 transition-all",
                status === 'done' ? "text-black hover:opacity-70" : "text-stone-300 cursor-not-allowed"
              )}
              disabled={status !== 'done'}
            >
              <RefreshCw className="w-4 h-4" /> Tạo mới
            </button>

            {!tiktokToken ? (
              <button 
                onClick={handleConnectTikTok}
                className="text-sm font-medium px-4 py-2 bg-stone-100 hover:bg-stone-200 rounded-xl transition-colors flex items-center gap-2"
              >
                <Share2 className="w-4 h-4" /> Kết nối TikTok
              </button>
            ) : (
              <div className="text-sm font-medium px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl flex items-center gap-2">
                <UserCheck className="w-4 h-4" /> Đã kết nối TikTok
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          
          {/* Left Column: Input */}
          <div className="space-y-8">
            <section className="bg-white rounded-3xl p-8 shadow-sm border border-black/5">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-stone-400 mb-6 flex items-center gap-2">
                <FileText className="w-4 h-4" /> 1. Nội dung tin tức
              </h2>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Nhập nội dung tin tức bạn muốn chuyển thể..."
                className="w-full h-48 bg-stone-50 rounded-2xl p-6 border-none focus:ring-2 focus:ring-black/5 resize-none text-lg leading-relaxed placeholder:text-stone-300"
              />
            </section>

            <section className="bg-white rounded-3xl p-8 shadow-sm border border-black/5">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-stone-400 mb-6 flex items-center gap-2">
                <Upload className="w-4 h-4" /> 2. Hình ảnh & Video minh họa ({mediaItems.length})
              </h2>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                {mediaItems.map((item, idx) => (
                  <div 
                    key={idx} 
                    draggable={!isTrimming}
                    onDragStart={() => handleDragStart(idx)}
                    onDragEnter={() => handleDragEnter(idx)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => e.preventDefault()}
                    className={cn(
                      "relative group aspect-video rounded-2xl overflow-hidden border border-black/5 bg-stone-50 transition-all",
                      !isTrimming ? "cursor-move" : "cursor-default"
                    )}
                    onMouseEnter={() => hoveredMediaIndexRef.current = idx}
                    onMouseLeave={() => hoveredMediaIndexRef.current = null}
                  >
                    {item.mimeType.startsWith('video') ? (
                      <video 
                        id={`video-preview-${idx}`}
                        src={item.base64} 
                        className="w-full h-full object-cover"
                        muted
                        onTimeUpdate={(e) => {
                          const v = e.target as HTMLVideoElement;
                          const endTime = item.endTime || v.duration;
                          if (v.currentTime >= endTime) {
                            v.pause();
                            v.currentTime = item.startTime || 0;
                            setPlayingMediaIndex(null);
                          }
                        }}
                        onEnded={() => setPlayingMediaIndex(null)}
                      />
                    ) : (
                      <img 
                        src={item.base64} 
                        alt={`Preview ${idx}`} 
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    
                    <div className="absolute top-2 left-2 bg-black/50 text-white text-[10px] px-2 py-1 rounded-lg backdrop-blur-sm flex items-center gap-1">
                      <GripVertical className="w-3 h-3" /> {idx + 1}
                    </div>

                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                      <button 
                        onClick={() => replaceMediaItem(idx)}
                        className="p-2 bg-white rounded-full text-black hover:bg-stone-100 transition-colors"
                        title="Thay thế"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => removeMediaItem(idx)}
                        className="p-2 bg-white rounded-full text-red-500 hover:bg-red-50 transition-colors"
                        title="Xóa"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {item.mimeType.startsWith('video') && item.duration && (
                      <div className="absolute bottom-0 left-0 right-0 p-3 bg-black/60 backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity border-t border-white/10">
                        <div className="flex flex-col gap-2">
                          <div className="relative h-1.5 bg-white/20 rounded-full overflow-hidden">
                            <div 
                              className="absolute h-full bg-white/60"
                              style={{
                                left: `${((item.startTime || 0) / item.duration) * 100}%`,
                                right: `${100 - ((item.endTime || item.duration) / item.duration) * 100}%`
                              }}
                            />
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const v = document.getElementById(`video-preview-${idx}`) as HTMLVideoElement;
                                if (v) {
                                  if (playingMediaIndex === idx) {
                                    v.pause();
                                    setPlayingMediaIndex(null);
                                  } else {
                                    v.currentTime = item.startTime || 0;
                                    v.play();
                                    setPlayingMediaIndex(idx);
                                  }
                                }
                              }}
                              className="p-1.5 bg-white/20 hover:bg-white/30 rounded-full text-white transition-colors"
                            >
                              {playingMediaIndex === idx ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                            </button>
                            <div className="flex-1 flex gap-2">
                              <input 
                                type="range" 
                                min="0" 
                                max={item.duration} 
                                step="0.1" 
                                value={item.startTime || 0} 
                                onMouseDown={() => setIsTrimming(true)}
                                onMouseUp={() => setIsTrimming(false)}
                                onTouchStart={() => setIsTrimming(true)}
                                onTouchEnd={() => setIsTrimming(false)}
                                onChange={(e) => updateMediaTrim(idx, parseFloat(e.target.value), item.endTime || item.duration || 0)}
                                className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-white"
                                title="Điểm bắt đầu"
                              />
                              <input 
                                type="range" 
                                min="0" 
                                max={item.duration} 
                                step="0.1" 
                                value={item.endTime || item.duration} 
                                onMouseDown={() => setIsTrimming(true)}
                                onMouseUp={() => setIsTrimming(false)}
                                onTouchStart={() => setIsTrimming(true)}
                                onTouchEnd={() => setIsTrimming(false)}
                                onChange={(e) => updateMediaTrim(idx, item.startTime || 0, parseFloat(e.target.value))}
                                className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-white"
                                title="Điểm kết thúc"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                
                <label className={cn(
                  "flex flex-col items-center justify-center aspect-video border-2 border-dashed rounded-2xl cursor-pointer transition-all",
                  "border-stone-200 hover:border-black/20 hover:bg-stone-50"
                )}>
                  <Upload className="w-6 h-6 text-stone-300 mb-2" />
                  <p className="text-stone-400 text-xs font-medium text-center px-2">Thêm Ảnh/Video (Ctrl+V)</p>
                  <input type="file" className="hidden" accept="image/*,video/*" multiple onChange={handleMediaUpload} />
                </label>
              </div>
            </section>

            <section className="bg-white rounded-3xl p-8 shadow-sm border border-black/5">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-stone-400 mb-6 flex items-center gap-2">
                <Type className="w-4 h-4" /> 3. Tiêu đề video
              </h2>
              <input
                type="text"
                value={videoTitle}
                onChange={(e) => setVideoTitle(e.target.value)}
                placeholder="Nhập tiêu đề (VD: TIN NÓNG, LỊCH VĨ MÔ...)"
                className="w-full bg-stone-50 rounded-2xl p-4 border-none focus:ring-2 focus:ring-black/5 text-lg font-bold uppercase placeholder:text-stone-300"
              />
              <p className="text-[10px] text-stone-400 mt-2 italic">
                * Tiêu đề sẽ tự động in hoa, xuống dòng và hiển thị trên lớp mask video.
              </p>
            </section>

            <section className="bg-white rounded-3xl p-8 shadow-sm border border-black/5">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-stone-400 mb-6 flex items-center gap-2">
                <Video className="w-4 h-4" /> 4. Lớp Mask Video
              </h2>
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 bg-stone-50 rounded-2xl border border-black/5">
                  <div className="w-16 h-16 bg-stone-200 rounded-lg overflow-hidden flex-shrink-0">
                    <img src={maskUrl} alt="Mask Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">Lớp phủ TLS1 Studio</p>
                    <p className="text-xs text-stone-400">Mặc định từ Google Drive</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button 
                      onClick={() => {
                        const input = prompt("Dán đường link ảnh .PNG từ Google Drive hoặc nhập File ID:", maskUrl.split('id=')[1] || '');
                        if (input) {
                          let id = input;
                          const match = input.match(/[-\w]{25,}/);
                          if (match) id = match[0];
                          setMaskUrl(`/api/proxy-drive?id=${id}`);
                        }
                      }}
                      className="text-xs font-medium text-stone-500 hover:text-black transition-colors text-left"
                    >
                      Dán link Google Drive
                    </button>
                    <label className="text-xs font-medium text-stone-500 hover:text-black transition-colors cursor-pointer">
                      Tải ảnh lên (.PNG, .JPG)
                      <input 
                        type="file" 
                        className="hidden" 
                        accept="image/*" 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onloadend = () => setMaskUrl(reader.result as string);
                            reader.readAsDataURL(file);
                          }
                        }} 
                      />
                    </label>
                  </div>
                </div>
              </div>
            </section>

            <section className="bg-white rounded-3xl p-8 shadow-sm border border-black/5">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-stone-400 mb-6 flex items-center gap-2">
                <Music className="w-4 h-4" /> 5. Nhạc nền (Tùy chọn)
              </h2>
              
              <div className="space-y-6">
                <label className={cn(
                  "relative flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-3xl cursor-pointer transition-all",
                  bgmFileName ? "border-emerald-200 bg-emerald-50/30" : "border-stone-200 hover:border-black/20 hover:bg-stone-50"
                )}>
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <Music className={cn("w-8 h-8 mb-2", bgmFileName ? "text-emerald-500" : "text-stone-300")} />
                    <p className={cn("text-sm font-medium", bgmFileName ? "text-emerald-600" : "text-stone-500")}>
                      {bgmFileName || "Tải lên nhạc nền của riêng bạn"}
                    </p>
                    <p className="text-stone-400 text-xs mt-1">MP3, WAV hoặc AAC</p>
                  </div>
                  <input type="file" className="hidden" accept="audio/*" onChange={handleBgmUpload} />
                </label>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-stone-500 flex items-center gap-2">
                      <Volume2 className="w-4 h-4" /> Âm lượng nhạc nền: {Math.round(bgmVolume * 100)}%
                    </span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="1" 
                    step="0.01" 
                    value={bgmVolume}
                    onChange={(e) => setBgmVolume(parseFloat(e.target.value))}
                    className="w-full h-2 bg-stone-100 rounded-lg appearance-none cursor-pointer accent-black"
                  />
                </div>
              </div>
            </section>
          </div>

          {/* Right Column: Output / Progress */}
          <div className="space-y-8">
            {status === 'idle' && (
              <div className="h-full flex flex-col items-center justify-center text-center p-12 border-2 border-dashed border-stone-200 rounded-3xl opacity-50">
                <div className="w-20 h-20 bg-stone-100 rounded-full flex items-center justify-center mb-6">
                  <Video className="w-10 h-10 text-stone-300" />
                </div>
                <h3 className="text-xl font-serif font-medium text-stone-400">Kết quả sẽ hiển thị tại đây</h3>
                <p className="text-stone-400 mt-2">Hãy nhập nội dung và tải ảnh lên để bắt đầu</p>
              </div>
            )}

            {isProcessing && (
              <div className="bg-white rounded-3xl p-8 shadow-sm border border-black/5 space-y-8">
                <h3 className="text-xl font-serif font-medium">Đang tạo nội dung...</h3>
                <div className="space-y-6">
                  <StepItem 
                    icon={<FileText className="w-4 h-4" />} 
                    label="Viết kịch bản tin tức" 
                    status={status === 'scripting' ? 'loading' : (status !== 'idle' ? 'done' : 'pending')} 
                  />
                  <StepItem 
                    icon={<Volume2 className="w-4 h-4" />} 
                    label="Chuyển thể giọng đọc AI" 
                    status={status === 'audio' ? 'loading' : (['video', 'done'].includes(status) ? 'done' : 'pending')} 
                  />
                  <StepItem 
                    icon={<Video className="w-4 h-4" />} 
                    label="Tổng hợp Video & Audio" 
                    status={status === 'video' ? 'loading' : (status === 'done' ? 'done' : 'pending')} 
                  />
                </div>
                <div className="p-4 bg-stone-50 rounded-2xl border border-black/5">
                  <p className="text-sm text-stone-500 leading-relaxed italic">
                    {status === 'video' ? "Đang ghép nhạc và tạo hiệu ứng cho video..." : "Đang chuẩn bị bản tin của bạn..."}
                  </p>
                  <p className="text-[10px] text-stone-400 mt-2">
                    * Nếu quá trình kéo dài, hệ thống có thể đang tự động thử lại do giới hạn băng thông API.
                  </p>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-100 rounded-3xl p-8 flex flex-col gap-4">
                <div className="flex gap-4">
                  <AlertCircle className="w-6 h-6 text-red-500 shrink-0" />
                  <div>
                    <h3 className="font-medium text-red-800">Lỗi xử lý (403 Forbidden)</h3>
                    <p className="text-red-600 mt-1 whitespace-pre-line">{error}</p>
                  </div>
                </div>
                
                <div className="mt-2 p-4 bg-white/50 rounded-2xl border border-red-200">
                  <h4 className="text-sm font-semibold text-red-800 mb-2">Hướng dẫn khắc phục:</h4>
                  <ol className="text-sm text-red-700 list-decimal ml-4 space-y-2">
                    <li>Truy cập <a href="https://console.cloud.google.com/" target="_blank" className="underline font-bold">Google Cloud Console</a>.</li>
                    <li>Chọn dự án của bạn và đảm bảo đã <strong>Bật Thanh Toán (Enable Billing)</strong>.</li>
                    <li>Tìm và bật <strong>Generative Language API</strong>.</li>
                    <li>Quay lại đây, nhấn nút bên dưới và chọn lại API Key từ dự án đó.</li>
                  </ol>
                </div>

                <div className="flex gap-3">
                  <button 
                    onClick={handleOpenKeySelector}
                    className="flex-1 bg-red-600 text-white py-3 rounded-2xl font-medium hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
                  >
                    <Key className="w-4 h-4" /> Chọn lại Key
                  </button>
                  <button 
                    onClick={() => window.location.reload()}
                    className="px-6 bg-white border border-red-200 text-red-700 py-3 rounded-2xl font-medium hover:bg-red-50 transition-colors"
                  >
                    Tải lại trang
                  </button>
                </div>
              </div>
            )}

            {status === 'done' && videoUrl && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                <section className="bg-[#323339] rounded-3xl overflow-hidden shadow-2xl shadow-black/20 aspect-[9/16] max-h-[70vh] mx-auto relative group">
                  <video 
                    ref={videoRef}
                    src={videoUrl} 
                    className="w-full h-full object-contain"
                    playsInline
                    controls
                  />
                </section>

                <section className="bg-white rounded-3xl p-8 shadow-sm border border-black/5">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-sm font-semibold uppercase tracking-widest text-stone-400 flex items-center gap-2">
                      <Volume2 className="w-4 h-4" /> Giọng đọc tin tức
                    </h3>
                  </div>
                  <div className="p-6 bg-stone-50 rounded-2xl border border-black/5 italic text-stone-600 leading-relaxed">
                    "{script}"
                  </div>
                </section>

                <div className="flex flex-col gap-4">
                  {tiktokToken && (
                    <button
                      onClick={() => handleUploadToTikTok()}
                      disabled={isUploading || uploadSuccess}
                      className={cn(
                        "w-full py-5 rounded-2xl font-medium transition-all flex items-center justify-center gap-3 shadow-lg",
                        uploadSuccess 
                          ? "bg-emerald-500 text-white" 
                          : "bg-[#fe2c55] text-white hover:opacity-90 shadow-[#fe2c55]/20"
                      )}
                    >
                      {isUploading ? (
                        <Loader2 className="w-6 h-6 animate-spin" />
                      ) : uploadSuccess ? (
                        <CheckCircle2 className="w-6 h-6" />
                      ) : (
                        <Send className="w-6 h-6" />
                      )}
                      {isUploading ? "Đang đăng TikTok..." : uploadSuccess ? "Đã đăng thành công!" : "Đăng TikTok Ngay Lập Tức"}
                    </button>
                  )}
                  
                  {!tiktokToken && (
                    <p className="text-center text-xs text-stone-400">
                      Kết nối TikTok ở góc trên để mở khóa tính năng đăng video trực tiếp.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="max-w-5xl mx-auto px-6 py-12 border-t border-black/5 text-center text-stone-400 text-sm">
        <p>© 2024 News Video Creator. Powered by Google Gemini & Veo.</p>
      </footer>
    </div>
  );
}

function StepItem({ icon, label, status }: { icon: React.ReactNode; label: string; status: 'pending' | 'loading' | 'done' }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center",
          status === 'loading' ? "bg-black text-white" : "bg-stone-100 text-stone-400"
        )}>
          {icon}
        </div>
        <span className={cn(
          "font-medium",
          status === 'loading' ? "text-black" : "text-stone-400"
        )}>{label}</span>
      </div>
      {status === 'loading' && <Loader2 className="w-5 h-5 animate-spin text-black" />}
      {status === 'done' && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
    </div>
  );
}
