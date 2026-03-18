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
    body: new Uint8Array(videoBuffer),
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

export { uploadToYouTube, uploadToFacebookReels };