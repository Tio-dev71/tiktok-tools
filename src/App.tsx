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
  GripVertical,
  Image as ImageIcon
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { renderNewsVideoLocally } from "./shared/newsVideoRenderer";

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

const DEFAULT_MASK_URL = '/effect/news-temp.jpg';
const DEFAULT_BGM_URL = '/effect/newsmusic.mp3';

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
  const [status, setStatus] = useState<'idle' | 'scripting' | 'audio' | 'generating_images' | 'video' | 'done' | 'error'>('idle');
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
  const [publishStatus, setPublishStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [publishResults, setPublishResults] = useState<any>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  
  const [hasApiKey, setHasApiKey] = useState(true);
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
    try {
      const localKey = (process.env.GEMINI_API_KEY || '').trim();
      if (localKey) {
        setHasApiKey(true);
        return;
      }
      if (window.aistudio) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(selected);
        return;
      }
      setHasApiKey(true);
    } catch {
      setHasApiKey(true);
    }
  };

  const handleOpenKeySelector = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
      return;
    }
    setError('Bản local không dùng cửa sổ chọn API Key của AI Studio. Hãy đặt GEMINI_API_KEY trong file .env rồi tải lại trang.');
    setHasApiKey(true);
  };

  const handleConnectTikTok = async () => {
    try {
      const response = await fetch('/api/auth/tiktok/url');
      const { url } = await response.json();
      window.open(url, 'tiktok_auth', 'width=600,height=700');
    } catch (err) {
      console.error("Failed to connect TikTok:", err);
      setError("Không thể kết nối với TikTok. Vui lòng kiểm tra cấu hình.");
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
    if (!content) return;
    
    setIsProcessing(true);
    setError(null);
    setScript(null);
    setAudioUrl(null);
    setVideoUrl(null);

    try {
      const gemini = new GeminiService();

      // Step 1: Generate Script
      setStatus('scripting');
      let generatedScript = await gemini.generateScript(content);
      
      // Extract the original hook and body
      const originalHook = generatedScript.split(/[.\n]/)[0];
      const scriptBody = generatedScript.substring(originalHook.length).trim().replace(/^[.\s]+/, '');
      
      // Auto-generate sensational title
      const generatedTitle = await gemini.generateTitle(generatedScript);
      setVideoTitle(generatedTitle);

      // Step 1.7: Synchronize Hook + Title
      // The user wants the title and the hook to be identical.
      // We'll use the generated title as the hook, but keep the original prefix (e.g. 🚨 TIN NÓNG)
      const finalHook = `${originalHook}: ${generatedTitle}`;
      generatedScript = `${finalHook}. ${scriptBody}`;
      setScript(generatedScript);
      setVideoTitle(finalHook);

      let workingMediaItems = [...mediaItems];
      if (workingMediaItems.length === 0) {
        setStatus('generating_images');
        const base64 = await gemini.generateImage(finalHook);
        workingMediaItems = [{
          base64: `data:image/png;base64,${base64}`,
          mimeType: 'image/png',
          startTime: 0,
          endTime: 0,
          duration: 0
        }];
        setMediaItems(workingMediaItems);
      }

      // Step 2: Generate Audio
      setStatus('audio');
      const audioResult = await gemini.generateAudio(generatedScript);      
      let finalMediaItems = [...workingMediaItems];

      // Step 2.5: Nếu chỉ có 1 ảnh, thử generate AI.
      // Chỉ cần fail 1 lần là bỏ luôn AI image và dùng ảnh gốc để render tiếp.
      if (workingMediaItems.length === 1) {
        setStatus('generating_images');

        const badgeForImage = finalHook;
        const sentences = generatedScript
          .split(/[.!?]\s+/)
          .map(s => s.trim())
          .filter(s => s.length > 5);

        const sourceImage = workingMediaItems[0];
        const generatedImages: {
          base64: string;
          mimeType: string;
          startTime?: number;
          endTime?: number;
          duration?: number;
        }[] = [];

        let disableAiImageGeneration = false;

        // Delay nhẹ trước khi gọi AI image
        await new Promise(resolve => setTimeout(resolve, 3000));

        for (let i = 0; i < sentences.length; i++) {
          const sentence = sentences[i];

          // Nếu đã fail trước đó thì bỏ luôn AI image
          if (disableAiImageGeneration) {
            generatedImages.push(sourceImage);
            continue;
          }

          try {
            let base64: string;

            if (i === 0) {
              base64 = await gemini.generateImage(
                sentence,
                sourceImage.base64,
                badgeForImage
              );
            } else {
              base64 = await gemini.generateImage(sentence);
            }

            generatedImages.push({
              base64: `data:image/png;base64,${base64}`,
              mimeType: 'image/png',
              startTime: 0,
              endTime: 0,
              duration: 0
            });
          } catch (e) {
            console.warn(
              `Generate image fail ở câu ${i + 1}, bỏ qua AI image và dùng ảnh gốc cho toàn bộ phần còn lại.`,
              e
            );

            disableAiImageGeneration = true;
            generatedImages.push(sourceImage);
          }

          if (!disableAiImageGeneration && i < sentences.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }

        finalMediaItems = generatedImages.length > 0 ? generatedImages : [sourceImage];
      }

      // Step 3: Generate Video Locally (No Veo needed)
      setStatus('video');
      const videoBlob = await renderNewsVideoLocally({
        mediaSources: finalMediaItems,
        audioBase64: audioResult.base64,
        title: finalHook,
        currentMaskUrl: maskUrl,
        fullScript: generatedScript,
        bgmVolume,
        bgmBase64: customBgm?.base64 || null,
      });

      const generatedVideoUrl = URL.createObjectURL(videoBlob);
      setVideoUrl(generatedVideoUrl);
      setAudioUrl(`data:${audioResult.mimeType};base64,${audioResult.base64}`);

      setStatus('done');

      try {
        setPublishStatus('uploading');
        const videoBlob = await (await fetch(generatedVideoUrl)).blob();
        const videoDataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(videoBlob);
        });

        const publishResponse = await fetch('/api/publish/all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoDataUrl,
            title: finalHook,
            description: generatedScript,
          }),
        });

        const rawText = await publishResponse.text();
        let publishPayload: any = {};
        try {
          publishPayload = rawText ? JSON.parse(rawText) : {};
        } catch {
          throw new Error(`Backend không trả JSON hợp lệ: ${rawText.slice(0, 300)}`);
        }

        if (!publishResponse.ok) {
          throw new Error(publishPayload.error || `Auto publish thất bại: ${rawText.slice(0, 300)}`);
        }
        if (!publishResponse.ok) {
          throw new Error(publishPayload.error || 'Không thể tự động đăng YouTube/Facebook');
        }

        setPublishResults(publishPayload.results || null);
        const hasAnySuccess = Boolean(publishPayload.results?.youtube?.success || publishPayload.results?.facebook?.success);
        const hasAnyFailure = Boolean((publishPayload.results?.youtube && !publishPayload.results.youtube.success) || (publishPayload.results?.facebook && !publishPayload.results.facebook.success));
        setPublishStatus(hasAnyFailure && !hasAnySuccess ? 'error' : 'done');
        if (hasAnyFailure && !hasAnySuccess) {
          setPublishError('Tạo video xong nhưng đăng tự động thất bại. Xem chi tiết bên dưới.');
        }
      } catch (publishErr: any) {
        console.error('Auto publish failed:', publishErr);
        setPublishStatus('error');
        setPublishError(publishErr.message || 'Không thể tự động đăng YouTube/Facebook');
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
          </div>

          {/* Centered Action Buttons - Fixed position as originally requested */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center gap-4">
            <button
              onClick={handleProcess}
              disabled={isProcessing || !content}
              className={cn(
                "px-5 py-2.5 rounded-xl font-sans text-sm font-medium transition-all flex items-center gap-2 shadow-lg",
                isProcessing || !content 
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

          <div className="flex items-center gap-3">
            <div className="text-sm font-medium px-4 py-2 bg-stone-100 rounded-xl flex items-center gap-2 text-stone-500">
              <Share2 className="w-4 h-4" /> YouTube: tự động
            </div>
            <div className="text-sm font-medium px-4 py-2 bg-stone-100 rounded-xl flex items-center gap-2 text-stone-500">
              <UserCheck className="w-4 h-4" /> Facebook: tự động
            </div>
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
                    status={status === 'audio' ? 'loading' : (['generating_images', 'video', 'done'].includes(status) ? 'done' : 'pending')} 
                  />
                  {mediaItems.length === 1 && (
                    <StepItem 
                      icon={<ImageIcon className="w-4 h-4" />} 
                      label="Tạo hình ảnh minh họa AI" 
                      status={status === 'generating_images' ? 'loading' : (['video', 'done'].includes(status) ? 'done' : 'pending')} 
                    />
                  )}
                  <StepItem 
                    icon={<Video className="w-4 h-4" />} 
                    label="Tổng hợp Video & Audio" 
                    status={status === 'video' ? 'loading' : (status === 'done' ? 'done' : 'pending')} 
                  />
                </div>
                <div className="p-4 bg-stone-50 rounded-2xl border border-black/5">
                  <p className="text-sm text-stone-500 leading-relaxed italic">
                    {status === 'video' ? "Đang ghép nhạc và tạo hiệu ứng cho video..." : 
                     status === 'generating_images' ? "Đang dùng AI tạo hình ảnh minh họa theo kịch bản..." :
                     "Đang chuẩn bị bản tin của bạn..."}
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
                  <div className="bg-stone-50 rounded-2xl border border-black/5 py-6 px-4 text-sm text-stone-600 space-y-3">
                    <div className="font-medium text-stone-800">Tự động đăng sau khi tạo video</div>
                    {publishStatus === 'uploading' && <div>Hệ thống đang tự động đăng lên YouTube Shorts và Facebook Reels...</div>}
                    {publishStatus === 'done' && (
                      <div className="space-y-2">
                        <div className="text-emerald-700">Đã xử lý xong bước tự động đăng.</div>
                        <div>YouTube: {publishResults?.youtube?.success ? 'thành công' : `thất bại${publishResults?.youtube?.error ? ` - ${publishResults.youtube.error}` : ''}`}</div>
                        <div>Facebook: {publishResults?.facebook?.success ? 'thành công' : `thất bại${publishResults?.facebook?.error ? ` - ${publishResults.facebook.error}` : ''}`}</div>
                      </div>
                    )}
                    {publishStatus === 'error' && (
                      <div className="space-y-2 text-red-600">
                        <div>{publishError || 'Tạo video xong nhưng không thể tự động đăng.'}</div>
                        {publishResults?.youtube && <div>YouTube: {publishResults.youtube.success ? 'thành công' : publishResults.youtube.error}</div>}
                        {publishResults?.facebook && <div>Facebook: {publishResults.facebook.success ? 'thành công' : publishResults.facebook.error}</div>}
                      </div>
                    )}
                    {publishStatus === 'idle' && <div>Sau khi render xong, app sẽ tự gọi backend để đăng lên YouTube Shorts và Facebook Reels nếu .env có đủ token.</div>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="max-w-5xl mx-auto px-6 py-12 border-t border-black/5 text-center text-stone-400 text-sm">
        <p>© 2026 by Tiodev</p>
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
