import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("APP_URL =", process.env.APP_URL);
console.log("TIKTOK_CLIENT_KEY =", process.env.TIKTOK_CLIENT_KEY);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // TikTok OAuth Config
  const TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
  const TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
  const REDIRECT_URI = `${process.env.APP_URL}/api/auth/tiktok/callback`;

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

      // Send success message to parent window and close popup
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
    const { videoBase64, accessToken, openId } = req.body;
    if (!videoBase64 || !accessToken) {
      return res.status(400).json({ error: "Missing video data or access token" });
    }

    try {
      // 1. Initialize Upload
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
            video_size: Math.ceil((videoBase64.length * 3) / 4), // Approximate size in bytes
            chunk_size: Math.ceil((videoBase64.length * 3) / 4),
            total_chunk_count: 1
          }
        })
      });

      const initData = await initResponse.json();
      if (initData.error) throw new Error(initData.error.message);

      const uploadUrl = initData.data.upload_url;
      const publishId = initData.data.publish_id;

      // 2. Upload Video Data
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

  // Vite middleware for development
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

// Serve Vite build
const distPath = path.resolve(process.cwd(), "dist");
app.use(express.static(distPath));
app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
