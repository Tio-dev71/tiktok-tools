import "dotenv/config";
import crypto from "crypto";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =====================
// PKCE helpers
// =====================
type PkceEntry = { verifier: string; createdAt: number };
const pkceStore = new Map<string, PkceEntry>();

function base64url(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function makeCodeVerifier() {
  // 32 bytes -> ~43 chars base64url, hợp lệ 43-128
  return base64url(crypto.randomBytes(32));
}

function makeCodeChallenge(verifier: string) {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return base64url(hash);
}

function cleanupPkceStore(maxAgeMs = 10 * 60 * 1000) {
  const now = Date.now();
  for (const [k, v] of pkceStore.entries()) {
    if (now - v.createdAt > maxAgeMs) pkceStore.delete(k);
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: "50mb" }));

  // =====================
  // TikTok OAuth (PKCE)
  // =====================
  app.get("/api/auth/tiktok/url", (req, res) => {
    cleanupPkceStore();

    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const appUrl = process.env.APP_URL;

    if (!clientKey) return res.status(500).json({ error: "TIKTOK_CLIENT_KEY not configured" });
    if (!appUrl) return res.status(500).json({ error: "APP_URL not configured" });

    const redirectUri = `${appUrl}/api/auth/tiktok/callback`;

    const scope = (process.env.TIKTOK_SCOPE || "user.info.basic").trim();

    const state = crypto.randomBytes(16).toString("hex");
    const verifier = makeCodeVerifier();
    const challenge = makeCodeChallenge(verifier);

    pkceStore.set(state, { verifier, createdAt: Date.now() });

    const url =
      "https://www.tiktok.com/v2/auth/authorize/?" +
      new URLSearchParams({
        client_key: clientKey,
        scope,
        response_type: "code",
        redirect_uri: redirectUri,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();

    res.json({ url });
  });

  app.get("/api/auth/tiktok/callback", async (req, res) => {
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");

    if (!code || !state) return res.status(400).send("Missing code/state");

    const saved = pkceStore.get(state);
    if (!saved) return res.status(400).send("Missing PKCE verifier for state (expired or invalid state)");
    pkceStore.delete(state);

    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    const appUrl = process.env.APP_URL;

    if (!clientKey) return res.status(500).send("TIKTOK_CLIENT_KEY not configured");
    if (!clientSecret) return res.status(500).send("TIKTOK_CLIENT_SECRET not configured");
    if (!appUrl) return res.status(500).send("APP_URL not configured");

    const redirectUri = `${appUrl}/api/auth/tiktok/callback`;

    try {
      const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Cache-Control": "no-cache",
        },
        body: new URLSearchParams({
          client_key: clientKey,
          client_secret: clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
          code_verifier: saved.verifier, // ✅ PKCE bắt buộc
        }),
      });

      const data: any = await response.json();
      if (!response.ok || data?.error) {
        const msg = data?.error_description || data?.error || `Token exchange failed (${response.status})`;
        throw new Error(msg);
      }

      res.type("html").send(`
        <html>
          <body>
            <script>
              (function () {
                const payload = ${JSON.stringify(data)};
                if (window.opener) {
                  window.opener.postMessage({ type: 'TIKTOK_AUTH_SUCCESS', data: payload }, '*');
                  window.close();
                } else {
                  window.location.href = '/';
                }
              })();
            </script>
            <p>Authentication successful. This window should close automatically.</p>
          </body>
        </html>
      `);
    } catch (err: any) {
      console.error("TikTok OAuth error:", err);
      res.status(500).send(`Authentication failed: ${err.message || String(err)}`);
    }
  });

  // =====================
  // TikTok Video Upload (FILE_UPLOAD)
  // =====================
  app.post("/api/tiktok/upload", async (req, res) => {
    const { videoBase64, accessToken } = req.body as {
      videoBase64?: string;
      accessToken?: string;
    };

    if (!videoBase64 || !accessToken) {
      return res.status(400).json({ error: "Missing videoBase64 or accessToken" });
    }

    try {
      const videoBuffer = Buffer.from(videoBase64, "base64");
      const videoSize = videoBuffer.length;

      // 1) init
      const initResponse = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          post_info: {
            title: "",
            privacy_level: "PUBLIC_TO_EVERYONE",
            disable_duet: false,
            disable_stitch: false,
            disable_comment: false,
            video_ad_tag: false,
          },
          source_info: {
            source: "FILE_UPLOAD",
            video_size: videoSize,
            chunk_size: videoSize,
            total_chunk_count: 1,
          },
        }),
      });

      const initData: any = await initResponse.json();
      if (!initResponse.ok || initData?.error) {
        const msg = initData?.error?.message || initData?.error || `Init failed (${initResponse.status})`;
        throw new Error(msg);
      }

      const uploadUrl = initData?.data?.upload_url;
      const publishId = initData?.data?.publish_id;
      if (!uploadUrl || !publishId) throw new Error("Missing upload_url/publish_id from init response");

      // 2) upload
      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": `bytes 0-${videoSize - 1}/${videoSize}`,
        },
        body: videoBuffer,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Video upload failed (${uploadResponse.status})`);
      }

      res.json({ success: true, publishId });
    } catch (err: any) {
      console.error("TikTok Upload error:", err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  // =====================
  // Proxy Google Drive (bypass CORS)
  // =====================
  app.get("/api/proxy-drive", async (req, res) => {
    const id = String(req.query.id || "");
    if (!id) return res.status(400).send("Missing ID");

    try {
      const driveUrl = `https://drive.google.com/uc?export=download&id=${id}`;
      const response = await fetch(driveUrl);
      if (!response.ok) throw new Error(`Drive fetch failed: ${response.status}`);

      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get("Content-Type");
      if (contentType) res.set("Content-Type", contentType);
      res.send(Buffer.from(buffer));
    } catch (err: any) {
      console.error("Proxy error:", err);
      res.status(500).send(err.message || String(err));
    }
  });

  // =====================
  // Vite middleware
  // =====================
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();