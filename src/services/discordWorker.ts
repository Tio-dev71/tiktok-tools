import { Client, GatewayIntentBits, Partials, Message } from "discord.js";
import PQueue from "p-queue";
import { runAutomationPipeline } from "./automationPipeline";

const queue = new PQueue({ concurrency: 1 });
const processedMessageIds = new Set<string>();

function parseDiscordMessage(message: Message) {
  const embed = message.embeds?.[0];

  const rawContent =
    (message.content || "").trim() ||
    (embed?.description || "").trim() ||
    "";

  const embedTitle = (embed?.title || "").trim();

  const attachmentImage =
    message.attachments?.find((a) => a.contentType?.startsWith("image/"))?.url ||
    message.attachments?.find((a) => /\.(png|jpg|jpeg|webp)$/i.test(a.name || ""))?.url ||
    null;

  const embedImage =
    embed?.image?.url ||
    embed?.thumbnail?.url ||
    null;

  const imageUrl = attachmentImage || embedImage || null;

  const titleMatch = rawContent.match(/TITLE:\s*(.+)/i);
  const contentMatch = rawContent.match(/CONTENT:\s*([\s\S]+)/i);

  if (titleMatch && contentMatch) {
    return {
      title: titleMatch[1].trim(),
      content: contentMatch[1].trim(),
      imageUrl,
    };
  }

  const lines = rawContent
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  return {
    title: embedTitle || lines[0] || "Tin mới",
    content: lines.slice(1).join(" ") || rawContent,
    imageUrl,
  };
}

export function startDiscordWorker() {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const channelId = process.env.DISCORD_CHANNEL_ID?.trim();
  const sourceBotId = process.env.DISCORD_SOURCE_BOT_ID?.trim();

  if (!token || !channelId || !sourceBotId) {
    console.warn("Discord worker skipped: thiếu biến môi trường");
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.on("ready", () => {
    console.log(`Discord worker ready: ${client.user?.tag}`);
  });

  client.on("messageCreate", async (message) => {
    try {
      if (message.channelId !== channelId) return;
    //   if (message.author.id !== sourceBotId) return;
      if (processedMessageIds.has(message.id)) {
        console.log("Bỏ qua message đã xử lý:", message.id);
        return;
      }

      const payload = parseDiscordMessage(message);
      if (!payload || !payload.content?.trim()) {
        console.log("Bỏ qua message vì không parse được nội dung");
        return;
      }

      processedMessageIds.add(message.id);

      await queue.add(async () => {
        try {
          console.log("Nhận job từ Discord:", payload.title, message.id);
          const result = await runAutomationPipeline(payload);
          console.log("Automation done:", result);
        } catch (e) {
          processedMessageIds.delete(message.id);
          throw e;
        }
      });
    } catch (e) {
      console.error("Discord worker error:", e);
    }
  });

  client.login(token);
}