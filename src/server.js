import "dotenv/config";
import express from "express";
import { askCodex } from "./codex.js";
import { askDeepSeek } from "./deepseek.js";
import { selectProvider } from "./routing.js";
import {
  calculateSignature,
  createEncryptedReply,
  decryptMessage,
  verifySignature,
} from "./wecom-crypto.js";

const config = {
  port: Number(process.env.PORT || 3000),
  token: process.env.WECOM_TOKEN || "",
  encodingAESKey: process.env.WECOM_ENCODING_AES_KEY || "",
  receiveId: process.env.WECOM_RECEIVE_ID || "",
  deepseekKey: process.env.DEEPSEEK_API_KEY || "",
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
  deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  codexKey: process.env.CODEX_API_KEY || "",
  codexBaseUrl: process.env.CODEX_BASE_URL || "https://www.speedyapi.best/v1",
  codexModel: process.env.CODEX_MODEL || "gpt-5.6-terra",
  codexReasoningEffort: process.env.CODEX_REASONING_EFFORT || "xhigh",
  defaultProvider: process.env.BOT_DEFAULT_PROVIDER || "deepseek",
  systemPrompt:
    process.env.BOT_SYSTEM_PROMPT ||
    "你是微信群里的智能助手。回答简洁、准确、友善；不知道时明确说明。",
  maxHistory: Math.max(0, Number(process.env.MAX_HISTORY_MESSAGES || 12)),
};

for (const [name, value] of [
  ["WECOM_TOKEN", config.token],
  ["WECOM_ENCODING_AES_KEY", config.encodingAESKey],
  ["DEEPSEEK_API_KEY", config.deepseekKey],
]) {
  if (!value) throw new Error(`${name} is required; copy .env.example to .env and fill it in`);
}

const app = express();
const conversations = new Map();
const processedMessageIds = new Set();
const rawBody = express.raw({ type: "*/*", limit: "1mb" });

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

function textFromMessage(message) {
  if (message?.msgtype !== "text") return "";
  return String(message.text?.content || "").trim();
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
      markdown: { content: content.slice(0, 4000) },
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`WeCom response_url failed: HTTP ${response.status} ${body.slice(0, 200)}`);
}

async function handleMessage(message) {
  const messageId = message.msgid || message.msg_id;
  if (messageId && processedMessageIds.has(messageId)) return;
  if (messageId) {
    processedMessageIds.add(messageId);
    if (processedMessageIds.size > 2000) processedMessageIds.delete(processedMessageIds.values().next().value);
  }

  const originalQuestion = textFromMessage(message);
  if (!originalQuestion || !message.response_url) return;
  const { provider, question } = selectProvider(originalQuestion);
  if (!question) return;

  const key = conversationKey(message);
  try {
    const history = conversations.get(key) || [];
    const answer = provider === "codex"
      ? await askCodex({
          apiKey: config.codexKey,
          baseUrl: config.codexBaseUrl,
          model: config.codexModel,
          reasoningEffort: config.codexReasoningEffort,
          systemPrompt: config.systemPrompt,
          history,
          question,
        })
      : await askDeepSeek({
          apiKey: config.deepseekKey,
          baseUrl: config.deepseekBaseUrl,
          model: config.deepseekModel,
          systemPrompt: config.systemPrompt,
          history,
          question,
        });
    appendHistory(key, question, answer);
    await sendReply(message.response_url, answer);
  } catch (error) {
    console.error("Message processing failed:", error.message);
    try {
      await sendReply(message.response_url, "抱歉，我暂时无法回答这个问题，请稍后再试。");
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
  if (!encrypted || !verifySignature(config.token, params.timestamp, params.nonce, encrypted, params.msgSignature)) {
    return response.status(401).send("invalid signature");
  }

  let message;
  try {
    message = parseIncomingMessage(decryptMessage(config.encodingAESKey, encrypted, config.receiveId));
  } catch (error) {
    console.error("Callback decryption failed:", error.message);
    return response.status(400).send("invalid callback");
  }

  // 企业微信要求尽快确认收到；DeepSeek 请求在响应之后异步执行。
  response.json(createEncryptedReply(config.token, config.encodingAESKey, "success", config.receiveId));
  void handleMessage(message);
});

app.listen(config.port, () => {
  console.log(`WeCom/DeepSeek bot listening on http://127.0.0.1:${config.port}`);
  console.log("Configure the public callback URL as https://your-domain/wechat/callback");
});
