import "dotenv/config";
import express from "express";
import { askCodex, transcribeAudio } from "./codex.js";
import {
  createMessageContent,
  messageType,
  replaceContentPrompt,
  UserMessageError,
} from "./message-content.js";
import { selectProvider } from "./routing.js";
import {
  createEncryptedReply,
  decryptMessage,
  verifySignature,
} from "./wecom-crypto.js";
import { createWeComMediaClient } from "./wecom-media.js";

function positiveEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const config = {
  port: Number(process.env.PORT || 3000),
  token: process.env.WECOM_TOKEN || "",
  encodingAESKey: process.env.WECOM_ENCODING_AES_KEY || "",
  receiveId: process.env.WECOM_RECEIVE_ID || "",
  codexKey: process.env.CODEX_API_KEY || "",
  codexBaseUrl: process.env.CODEX_BASE_URL || "https://www.speedyapi.best/v1",
  codexModel: process.env.CODEX_MODEL || "gpt-5.6-terra",
  codexReasoningEffort: process.env.CODEX_REASONING_EFFORT || "xhigh",
  codexTimeoutMs: positiveEnv("CODEX_TIMEOUT_MS", 120_000),
  codexTranscriptionModel: process.env.CODEX_TRANSCRIPTION_MODEL || "",
  codexFilePartType: process.env.CODEX_FILE_PART_TYPE || "file",
  wecomCorpId: process.env.WECOM_CORP_ID || "",
  wecomCorpSecret: process.env.WECOM_CORP_SECRET || "",
  maxMediaBytes: positiveEnv("MAX_MEDIA_BYTES", 10 * 1024 * 1024),
  mediaFetchTimeoutMs: positiveEnv("MEDIA_FETCH_TIMEOUT_MS", 30_000),
  maxFileTextChars: positiveEnv("MAX_FILE_TEXT_CHARS", 60_000),
  systemPrompt:
    process.env.BOT_SYSTEM_PROMPT ||
    "你是微信群里的智能助手。回答简洁、准确、友善；不知道时明确说明。",
  maxHistory: Math.max(0, Number(process.env.MAX_HISTORY_MESSAGES || 12)),
};

for (const [name, value] of [
  ["WECOM_TOKEN", config.token],
  ["WECOM_ENCODING_AES_KEY", config.encodingAESKey],
  ["CODEX_API_KEY", config.codexKey],
]) {
  if (!value) throw new Error(`${name} is required; copy .env.example to .env and fill it in`);
}

const app = express();
const conversations = new Map();
const processedMessageIds = new Set();
const rawBody = express.raw({ type: "*/*", limit: "1mb" });
const mediaClient = createWeComMediaClient({
  corpId: config.wecomCorpId,
  corpSecret: config.wecomCorpSecret,
  maxBytes: config.maxMediaBytes,
  timeoutMs: config.mediaFetchTimeoutMs,
});

function queryParams(request) {
  return {
    timestamp: request.query.timestamp || "",
    nonce: request.query.nonce || "",
    msgSignature: request.query.msg_signature || "",
    echoStr: request.query.echostr || "",
  };
}

function extractEncryptedBody(buffer) {
  const text = buffer.toString("utf8").trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    return typeof parsed.encrypt === "string" ? parsed.encrypt : "";
  } catch {
    const match = text.match(/<Encrypt>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/Encrypt>/i);
    return match?.[1] || "";
  }
}

function parseIncomingMessage(plainText) {
  try {
    return JSON.parse(plainText);
  } catch {
    throw new Error("Decrypted callback is not valid JSON");
  }
}

function conversationKey(message) {
  return String(message.chatid || message.from?.userid || "default");
}

function appendHistory(key, userText, answer) {
  if (config.maxHistory === 0) return;
  const current = conversations.get(key) || [];
  current.push({ role: "user", content: userText }, { role: "assistant", content: answer });
  conversations.set(key, current.slice(-config.maxHistory));
}

function safeResponseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

async function sendReply(responseUrl, content) {
  const url = safeResponseUrl(responseUrl);
  if (!url) throw new Error("Missing or invalid response_url");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msgtype: "markdown",
      markdown: { content: String(content || "").slice(0, 4000) },
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`WeCom response_url failed: HTTP ${response.status} ${body.slice(0, 200)}`);
}

function publicProcessingError(error, kind) {
  if (error instanceof UserMessageError) {
    if (error.code === "MEDIA_CREDENTIALS_MISSING") {
      return "已收到媒体，但服务器还没有配置企业微信媒体下载权限。请管理员在 Railway 添加 WECOM_CORP_ID 和 WECOM_CORP_SECRET。";
    }
    if (error.code === "MEDIA_TOO_LARGE") {
      return "这个媒体文件超过服务器大小限制，请压缩后再发送。";
    }
    if (error.code === "VOICE_TRANSCRIPTION_UNAVAILABLE" || error.code === "VOICE_TRANSCRIPTION_FAILED") {
      return "语音没有得到可用的文字转写，请开启企业微信语音识别，或检查 CODEX_TRANSCRIPTION_MODEL 配置。";
    }
    return error.message;
  }
  if (kind === "file") {
    return "附件已收到，但当前 Codex 兼容接口没有接受这种文件输入格式。请确认 CODEX_FILE_PART_TYPE 与接口文档一致，或先发送 PDF/Word 的文字内容。";
  }
  if (kind === "image") {
    return "图片已收到，但当前 Codex 兼容接口没有接受图片输入。请确认该模型和接口已启用视觉能力。";
  }
  return "抱歉，我暂时无法回答这个问题，请稍后再试。";
}

async function handleMessage(message) {
  const messageId = message.msgid || message.msg_id;
  if (messageId && processedMessageIds.has(messageId)) return;
  if (messageId) {
    processedMessageIds.add(messageId);
    if (processedMessageIds.size > 2000) processedMessageIds.delete(processedMessageIds.values().next().value);
  }

  const type = messageType(message);
  const responseUrl = message.response_url || message.responseUrl;
  console.log("WeCom message received", JSON.stringify({
    msgtype: type,
    hasResponseUrl: Boolean(responseUrl),
    hasMediaId: Boolean(message?.image?.media_id || message?.file?.media_id || message?.voice?.media_id),
    hasImageUrl: Boolean(message?.image?.url),
    mixedItemCount: Array.isArray(message?.mixed?.msg_item) ? message.mixed.msg_item.length : 0,
  }));
  if (!responseUrl) return;

  let input;
  const key = conversationKey(message);
  try {
    input = await createMessageContent(message, {
      mediaClient,
      maxMediaBytes: config.maxMediaBytes,
      maxFileTextChars: config.maxFileTextChars,
      filePartType: config.codexFilePartType,
      transcribeAudio: config.codexTranscriptionModel
        ? ({ bytes, filename, mimeType }) => transcribeAudio({
          apiKey: config.codexKey,
          baseUrl: config.codexBaseUrl,
          model: config.codexTranscriptionModel,
          bytes,
          filename,
          mimeType,
          timeoutMs: config.codexTimeoutMs,
        })
        : null,
    });

    const routed = selectProvider(input.question || input.defaultQuestion);
    const question = routed.question || input.defaultQuestion || "";
    console.log("Message routed", JSON.stringify({ provider: routed.provider, msgtype: input.kind, questionLength: question.length }));
    if (!question) return;

    const history = conversations.get(key) || [];
    const answer = await askCodex({
      apiKey: config.codexKey,
      baseUrl: config.codexBaseUrl,
      model: config.codexModel,
      reasoningEffort: config.codexReasoningEffort,
      systemPrompt: config.systemPrompt,
      history,
      question,
      userContent: replaceContentPrompt(input.userContent, question),
      timeoutMs: config.codexTimeoutMs,
    });
    const historyQuestion = input.historyLabel ? `[${input.historyLabel}] ${question}` : question;
    appendHistory(key, historyQuestion, answer);
    await sendReply(responseUrl, answer);
  } catch (error) {
    console.error("Message processing failed:", error.message);
    try {
      await sendReply(responseUrl, publicProcessingError(error, input?.kind || type));
    } catch (replyError) {
      console.error("Fallback reply failed:", replyError.message);
    }
  }
}

app.get("/healthz", (_request, response) => response.json({ ok: true }));

app.get("/wechat/callback", (request, response) => {
  const params = queryParams(request);
  if (!params.echoStr) return response.status(400).send("missing echostr");
  if (!verifySignature(config.token, params.timestamp, params.nonce, params.echoStr, params.msgSignature)) {
    return response.status(401).send("invalid signature");
  }
  try {
    return response.type("text/plain").send(decryptMessage(config.encodingAESKey, params.echoStr, config.receiveId));
  } catch (error) {
    console.error("URL verification failed:", error.message);
    return response.status(401).send("invalid echostr");
  }
});

app.post("/wechat/callback", rawBody, (request, response) => {
  const params = queryParams(request);
  const encrypted = extractEncryptedBody(request.body);
  const validSignature = Boolean(
    encrypted && verifySignature(config.token, params.timestamp, params.nonce, encrypted, params.msgSignature),
  );
  console.log("WeCom callback received", JSON.stringify({
    hasEncryptedBody: Boolean(encrypted),
    hasSignature: Boolean(params.msgSignature),
    validSignature,
  }));
  if (!validSignature) {
    console.error("WeCom callback rejected");
    return response.status(401).send("invalid signature");
  }

  let message;
  try {
    message = parseIncomingMessage(decryptMessage(config.encodingAESKey, encrypted, config.receiveId));
  } catch (error) {
    console.error("Callback decryption failed:", error.message);
    return response.status(400).send("invalid callback");
  }

  // 企业微信要求尽快确认收到；Codex 请求在响应之后异步执行。
  response.json(createEncryptedReply(config.token, config.encodingAESKey, "success", config.receiveId));
  void handleMessage(message);
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`WeCom/Codex bot listening on 0.0.0.0:${config.port}`);
  console.log("Configure the public callback URL as https://your-domain/wechat/callback");
});
