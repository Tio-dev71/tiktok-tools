import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_URL = process.env.APP_URL || "http://localhost:3000";

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mimeType: string } {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("Dữ liệu video không đúng định dạng base64 data URL");
  }
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

async function getYouTubeAccessToken() {
  const directAccessToken = process.env.YOUTUBE_ACCESS_TOKEN?.trim();
  if (directAccessToken) return directAccessToken;

  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN?.trim();
  const clientId = process.env.YOUTUBE_CLIENT_ID?.trim();
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim();

  if (!refreshToken || !clientId) {
    throw new Error(
      "Thiếu YOUTUBE_ACCESS_TOKEN hoặc bộ YOUTUBE_REFRESH_TOKEN + YOUTUBE_CLIENT_ID (+ YOUTUBE_CLIENT_SECRET nếu có)."
    );
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret || "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || "Không refresh được YouTube access token");
  }
  return tokenData.access_token as string;
}

async function uploadToYouTube({ videoBuffer, title, description }: { videoBuffer: Buffer; title: string; description: string; }) {
  const accessToken = await getYouTubeAccessToken();
  const boundary = `youtube_boundary_${Date.now()}`;
  const metadata = {
    snippet: {
      title: title || "Short video",
      description: description || "",
      tags: ["shorts"],
      categoryId: "22",
    },
    status: {
      privacyStatus: (process.env.YOUTUBE_PRIVACY_STATUS || "public").trim(),
      selfDeclaredMadeForKids: false,
    },
  };

  const preamble = Buffer.from(
    `--${boundary}
Content-Type: application/json; charset=UTF-8

${JSON.stringify(metadata)}
--${boundary}
Content-Type: video/mp4

`,
    "utf8"
  );
  const closing = Buffer.from(`
--${boundary}--`, "utf8");
  const body = Buffer.concat([preamble, videoBuffer, closing]);

  const uploadRes = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  });

  const result = await uploadRes.json();
  if (!uploadRes.ok) {
    throw new Error(result?.error?.message || result?.error_description || "Upload YouTube thất bại");
  }
  return result;
}

async function resolveFacebookPageAccess() {
  const explicitPageId = process.env.FACEBOOK_PAGE_ID?.trim();
  const explicitPageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim();
  if (explicitPageId && explicitPageToken) {
    return { pageId: explicitPageId, pageAccessToken: explicitPageToken };
  }

  const fallbackTokenRaw = process.env.FACEBOOK_USER_ACCESS_TOKEN?.trim() || process.env.FACEBOOK_APP_SECRET?.trim();
  if (!fallbackTokenRaw) {
    throw new Error("Thiếu FACEBOOK_PAGE_ACCESS_TOKEN hoặc FACEBOOK_USER_ACCESS_TOKEN.");
  }

  const pagesRes = await fetch(`https://graph.facebook.com/v25.0/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(fallbackTokenRaw)}`);
  const pagesData = await pagesRes.json();
  if (!pagesRes.ok || !Array.isArray(pagesData.data)) {
    throw new Error(pagesData?.error?.message || "Không lấy được danh sách fanpage Facebook");
  }

  if (pagesData.data.length === 0) {
    throw new Error("Token Facebook không thấy fanpage nào có quyền đăng bài");
  }

  let page = pagesData.data[0];
  const pageNameOrId = process.env.FACEBOOK_PAGE_NAME?.trim() || explicitPageId;
  if (pageNameOrId) {
    const found = pagesData.data.find((p: any) => p.id === pageNameOrId || p.name === pageNameOrId);
    if (found) page = found;
  }

  return { pageId: page.id as string, pageAccessToken: page.access_token as string, pageName: page.name as string };
}

async function uploadToFacebookReels({ videoBuffer, title, description }: { videoBuffer: Buffer; title: string; description: string; }) {
  const { pageId, pageAccessToken, pageName } = await resolveFacebookPageAccess();

  const startRes = await fetch(`https://graph.facebook.com/v25.0/${pageId}/video_reels`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      access_token: pageAccessToken,
      upload_phase: "start",
    }),
  });
  const startData = await startRes.json();
  if (!startRes.ok || !startData.video_id || !startData.upload_url) {
    throw new Error(startData?.error?.message || "Không khởi tạo được Facebook Reel upload session");
  }

  const uploadRes = await fetch(startData.upload_url, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${pageAccessToken}`,
      offset: "0",
      file_size: String(videoBuffer.length),
      "Content-Type": "application/octet-stream",
    },
    body: videoBuffer,
  });

  const uploadText = await uploadRes.text();
  let uploadData: any = {};
  try {
    uploadData = uploadText ? JSON.parse(uploadText) : {};
  } catch {
    uploadData = { raw: uploadText };
  }

  if (!uploadRes.ok) {
    throw new Error(uploadData?.error?.message || uploadData?.debug_info?.message || uploadText || "Tải video lên Facebook thất bại");
  }

  const finishRes = await fetch(`https://graph.facebook.com/v25.0/${pageId}/video_reels`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      access_token: pageAccessToken,
      upload_phase: "finish",
      video_id: startData.video_id,
      video_state: "PUBLISHED",
      description: description || "",
      title: title || "",
    }),
  });
  const finishData = await finishRes.json();
  if (!finishRes.ok || finishData.success === false) {
    throw new Error(finishData?.error?.message || "Publish Facebook Reel thất bại");
  }

  return { pageId, pageName, videoId: startData.video_id, upload: uploadData, publish: finishData };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '200mb' }));

  // TikTok OAuth Config
  const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
  const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
  const REDIRECT_URI = `${APP_URL}/api/auth/tiktok/callback`;

  // TikTok Auth URL
  app.get("/api/auth/tiktok/url", (req, res) => {
    if (!TIKTOK_CLIENT_KEY) {
      return res.status(500).json({ error: "TIKTOK_CLIENT_KEY not configured" });
    }
    const state = Math.random().toString(36).substring(7);
    const url = `https://www.tiktok.com/v2/auth/authorize/?client_key=${TIKTOK_CLIENT_KEY}&scope=video.upload,video.publish,user.info.basic&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}`;
    res.json({ url });
  });

  // TikTok Auth Callback
  app.get("/api/auth/tiktok/callback", async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send("No code provided");

    try {
      const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Cache-Control": "no-cache",
        },
        body: new URLSearchParams({
          client_key: TIKTOK_CLIENT_KEY!,
          client_secret: TIKTOK_CLIENT_SECRET!,
          code: code as string,
          grant_type: "authorization_code",
          redirect_uri: REDIRECT_URI,
        }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error_description || data.error);

      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'TIKTOK_AUTH_SUCCESS', data: ${JSON.stringify(data)} }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. This window should close automatically.</p>
          </body>
        </html>
      `);
    } catch (error: any) {
      console.error("TikTok OAuth error:", error);
      res.status(500).send(`Authentication failed: ${error.message}`);
    }
  });

  // TikTok Video Upload
  app.post("/api/tiktok/upload", async (req, res) => {
    const { videoBase64, accessToken } = req.body;
    if (!videoBase64 || !accessToken) {
      return res.status(400).json({ error: "Missing video data or access token" });
    }

    try {
      const initResponse = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          post_info: {
            title: "",
            privacy_level: "PUBLIC_TO_EVERYONE",
            disable_duet: false,
            disable_stitch: false,
            disable_comment: false,
            video_ad_tag: false
          },
          source_info: {
            source: "FILE_UPLOAD",
            video_size: Math.ceil((videoBase64.length * 3) / 4),
            chunk_size: Math.ceil((videoBase64.length * 3) / 4),
            total_chunk_count: 1
          }
        })
      });

      const initData = await initResponse.json();
      if (initData.error) throw new Error(initData.error.message);

      const uploadUrl = initData.data.upload_url;
      const publishId = initData.data.publish_id;
      const videoBuffer = Buffer.from(videoBase64, 'base64');
      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": `bytes 0-${videoBuffer.length - 1}/${videoBuffer.length}`,
        },
        body: videoBuffer
      });

      if (!uploadResponse.ok) throw new Error("Video upload failed");

      res.json({ success: true, publishId });
    } catch (error: any) {
      console.error("TikTok Upload error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/publish/config', async (_req, res) => {
    const youtubeReady = Boolean(process.env.YOUTUBE_ACCESS_TOKEN || process.env.YOUTUBE_REFRESH_TOKEN);
    const facebookReady = Boolean(process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_USER_ACCESS_TOKEN || process.env.FACEBOOK_APP_SECRET);
    res.json({ youtubeReady, facebookReady });
  });

  app.post('/api/publish/all', async (req, res) => {
    const { videoDataUrl, title, description } = req.body || {};
    if (!videoDataUrl) {
      return res.status(400).json({ error: 'Thiếu videoDataUrl' });
    }

    try {
      const { buffer } = dataUrlToBuffer(videoDataUrl);
      const results: any = {};

      if (process.env.YOUTUBE_ACCESS_TOKEN || process.env.YOUTUBE_REFRESH_TOKEN) {
        try {
          results.youtube = { success: true, data: await uploadToYouTube({ videoBuffer: buffer, title: title || 'Short video', description: description || '' }) };
        } catch (error: any) {
          results.youtube = { success: false, error: error.message };
        }
      } else {
        results.youtube = { success: false, skipped: true, error: 'Thiếu YOUTUBE_ACCESS_TOKEN hoặc YOUTUBE_REFRESH_TOKEN trong .env' };
      }

      if (process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_USER_ACCESS_TOKEN || process.env.FACEBOOK_APP_SECRET) {
        try {
          results.facebook = { success: true, data: await uploadToFacebookReels({ videoBuffer: buffer, title: title || '', description: description || '' }) };
        } catch (error: any) {
          results.facebook = { success: false, error: error.message };
        }
      } else {
        results.facebook = { success: false, skipped: true, error: 'Thiếu FACEBOOK_PAGE_ACCESS_TOKEN hoặc FACEBOOK_USER_ACCESS_TOKEN trong .env' };
      }

      res.json({ success: true, results });
    } catch (error: any) {
      console.error('Auto publish error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Proxy for Google Drive files to bypass CORS
  app.get("/api/proxy-drive", async (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).send("Missing ID");
    try {
      const driveUrl = `https://drive.google.com/uc?export=download&id=${id}`;
      const response = await fetch(driveUrl);
      if (!response.ok) throw new Error(`Drive fetch failed: ${response.status}`);

      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get('Content-Type');
      if (contentType) res.set('Content-Type', contentType);
      res.send(Buffer.from(buffer));
    } catch (error: any) {
      console.error("Proxy error:", error);
      res.status(500).send(error.message);
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
