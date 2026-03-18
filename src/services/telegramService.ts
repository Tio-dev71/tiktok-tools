import fs from "fs";
import path from "path";

export async function sendVideoToTelegram(params: {
  filePath: string;
  caption?: string;
}) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

  if (!token || !chatId) {
    throw new Error("Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID");
  }

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", params.caption || "");

  const fileBuffer = fs.readFileSync(params.filePath);
  const fileName = path.basename(params.filePath);
  const blob = new Blob([fileBuffer], { type: "video/mp4" });
  form.append("video", blob, fileName);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
    method: "POST",
    body: form,
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data?.description || "Gửi Telegram thất bại");
  }

  return data;
}