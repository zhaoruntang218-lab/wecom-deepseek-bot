import { createWeComMediaClient, WeComMediaError } from "./wecom-media.js";

const DEFAULT_MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_FILE_TEXT_CHARS = 60_000;
const DEFAULT_FILE_PART_TYPE = "file";

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cfg",
  ".conf",
  ".cpp",
  ".csv",
  ".css",
  ".go",
  ".h",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".log",
  ".md",
  ".mjs",
  ".py",
  ".sql",
  ".svg",
  ".text",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const MIME_EXTENSIONS = new Map([
  ["application/csv", ".csv"],
  ["application/json", ".json"],
  ["application/rtf", ".rtf"],
  ["application/xml", ".xml"],
  ["text/csv", ".csv"],
  ["text/html", ".html"],
  ["text/markdown", ".md"],
  ["text/plain", ".txt"],
  ["text/xml", ".xml"],
]);

const EXTENSION_MIME_TYPES = new Map([
  [".csv", "text/csv"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".json", "application/json"],
  [".md", "text/markdown"],
  [".mp3", "audio/mpeg"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".txt", "text/plain"],
  [".wav", "audio/wav"],
  [".webp", "image/webp"],
  [".xml", "application/xml"],
]);

export class UserMessageError extends Error {
  constructor(message, code = "USER_MESSAGE_ERROR") {
    super(message);
    this.name = "UserMessageError";
    this.code = code;
  }
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstString(...values) {
  for (const value of values) {
    const result = stringValue(value);
    if (result) return result;
  }
  return "";
}

function normalizeMimeType(value, fallback = "application/octet-stream") {
  const mimeType = firstString(value).split(";", 1)[0].toLowerCase();
  return /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(mimeType) ? mimeType : fallback;
}

function filenameFromUrl(value) {
  try {
    const pathname = new URL(value).pathname;
    const name = decodeURIComponent(pathname.split("/").pop() || "");
    return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120);
  } catch {
    return "";
  }
}

function safeFilename(value, fallback = "attachment") {
  const filename = firstString(value) || fallback;
  return filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120) || fallback;
}

function extensionOf(filename) {
  const match = String(filename || "").toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] || "";
}

function isTextFile({ filename, mimeType }) {
  const normalizedMime = normalizeMimeType(mimeType);
  return normalizedMime.startsWith("text/") || MIME_EXTENSIONS.has(normalizedMime) || TEXT_EXTENSIONS.has(extensionOf(filename));
}

function mimeTypeForFilename(filename, fallback) {
  return EXTENSION_MIME_TYPES.get(extensionOf(filename)) || normalizeMimeType(fallback);
}

function toDataUrl(bytes, mimeType) {
  return `data:${normalizeMimeType(mimeType)};base64,${Buffer.from(bytes).toString("base64")}`;
}

function parseDataUrl(value, maxBytes, mimeType = "application/octet-stream") {
  const raw = stringValue(value);
  const match = raw.match(/^data:([^;,]+)?;base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const bytes = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (bytes.length > maxBytes) {
    throw new UserMessageError(`媒体超过 ${maxBytes} 字节大小限制`, "MEDIA_TOO_LARGE");
  }
  return {
    bytes,
    bytesLength: bytes.length,
    mimeType: normalizeMimeType(match[1], normalizeMimeType(mimeType)),
    filename: "",
  };
}

function parseBase64(value, maxBytes, mimeType) {
  const raw = stringValue(value).replace(/\s+/g, "");
  if (!raw || raw.length % 4 === 1 || !/^[a-z0-9+/]+={0,2}$/i.test(raw)) return null;
  const bytes = Buffer.from(raw, "base64");
  if (!bytes.length) return null;
  if (bytes.length > maxBytes) {
    throw new UserMessageError(`媒体超过 ${maxBytes} 字节大小限制`, "MEDIA_TOO_LARGE");
  }
  return { bytes, bytesLength: bytes.length, mimeType: normalizeMimeType(mimeType), filename: "" };
}

function descriptorFor(message) {
  const type = String(message?.msgtype || "").toLowerCase();
  const payload = message?.[type] || {};
  if (type === "image") {
    return {
      type,
      payload,
      mediaId: firstString(payload.media_id, payload.mediaId),
      url: firstString(payload.url, payload.pic_url, payload.image_url, payload.download_url),
      data: firstString(payload.data, payload.base64, payload.image_data),
      mimeType: firstString(payload.mime_type, payload.mimeType, "image/jpeg"),
      filename: firstString(payload.filename, payload.name, "image.jpg"),
    };
  }
  if (type === "file") {
    return {
      type,
      payload,
      mediaId: firstString(payload.media_id, payload.mediaId),
      url: firstString(payload.url, payload.file_url, payload.download_url),
      data: firstString(payload.data, payload.base64, payload.file_data),
      mimeType: firstString(payload.mime_type, payload.mimeType),
      filename: firstString(payload.filename, payload.name, payload.file_name),
    };
  }
  if (type === "voice") {
    return {
      type,
      payload,
      mediaId: firstString(payload.media_id, payload.mediaId),
      url: firstString(payload.url, payload.download_url),
      data: firstString(payload.data, payload.base64, payload.audio_data),
      mimeType: firstString(payload.mime_type, payload.mimeType, "audio/mpeg"),
      filename: firstString(payload.filename, payload.name, "voice.audio"),
    };
  }
  return { type, payload };
}

function captionFromMessage(message) {
  const type = String(message?.msgtype || "").toLowerCase();
  const payload = message?.[type] || {};
  return firstString(
    message?.text?.content,
    message?.caption,
    payload.caption,
    payload.question,
    payload.content,
  );
}

function recognitionFromMessage(message) {
  const payload = message?.voice || {};
  return firstString(payload.content, payload.recognition, payload.transcription, payload.transcript, payload.text);
}

export function messageType(message) {
  return String(message?.msgtype || "").toLowerCase();
}

export function isMediaMessage(message) {
  return ["image", "file", "voice", "mixed"].includes(messageType(message));
}

async function resolveMedia(descriptor, { mediaClient, maxBytes }) {
  const directData = parseDataUrl(descriptor.data, maxBytes, descriptor.mimeType);
  if (directData) return directData;
  const base64 = descriptor.data ? parseBase64(descriptor.data, maxBytes, descriptor.mimeType) : null;
  if (base64) return base64;

  const inlineUrl = parseDataUrl(descriptor.url, maxBytes, descriptor.mimeType);
  if (inlineUrl) return inlineUrl;
  const url = descriptor.url || (/^https:\/\//i.test(descriptor.data) ? descriptor.data : "");
  if (url) {
    if (!mediaClient?.fetchUrl) {
      throw new UserMessageError("当前服务没有启用媒体下载", "MEDIA_CLIENT_MISSING");
    }
    try {
      return await mediaClient.fetchUrl(url, {
        filename: safeFilename(descriptor.filename || filenameFromUrl(url), "attachment"),
        mediaId: descriptor.mediaId,
      });
    } catch (error) {
      if (error instanceof WeComMediaError) throw new UserMessageError(error.message, error.code);
      throw new UserMessageError("媒体地址无法读取", "MEDIA_DOWNLOAD_FAILED");
    }
  }

  if (descriptor.mediaId) {
    if (!mediaClient?.downloadMedia) {
      throw new UserMessageError("当前服务没有启用企业微信媒体下载", "MEDIA_CLIENT_MISSING");
    }
    try {
      return await mediaClient.downloadMedia(descriptor.mediaId, {
        filename: safeFilename(descriptor.filename, "attachment"),
      });
    } catch (error) {
      if (error instanceof WeComMediaError) throw new UserMessageError(error.message, error.code);
      throw new UserMessageError("企业微信媒体无法读取", "MEDIA_DOWNLOAD_FAILED");
    }
  }

  throw new UserMessageError("回调中没有可读取的媒体内容", "MEDIA_CONTENT_MISSING");
}

function decodeText(bytes, maxChars) {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replaceAll("\u0000", "");
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

function imageContent(prompt, source) {
  const mimeType = normalizeMimeType(source.mimeType, "image/jpeg");
  const url = source.bytes ? toDataUrl(source.bytes, mimeType) : source.url;
  if (!url) throw new UserMessageError("图片内容为空", "IMAGE_CONTENT_MISSING");
  return [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url } },
  ];
}

function fileContent(prompt, source, filename, filePartType) {
  const dataUrl = source.bytes ? toDataUrl(source.bytes, source.mimeType) : "";
  if (!dataUrl) throw new UserMessageError("附件内容为空", "FILE_CONTENT_MISSING");
  if (filePartType === "input_file") {
    return [
      { type: "text", text: prompt },
      { type: "input_file", filename, file_data: dataUrl },
    ];
  }
  return [
    { type: "text", text: prompt },
    { type: "file", file: { filename, file_data: dataUrl } },
  ];
}

export function replaceContentPrompt(content, prompt) {
  if (!Array.isArray(content)) {
    const attachmentMarker = "\n\n附件文件名：";
    const markerIndex = typeof content === "string" ? content.indexOf(attachmentMarker) : -1;
    return markerIndex >= 0 ? `${prompt}${content.slice(markerIndex)}` : prompt;
  }
  const firstTextIndex = content.findIndex((part) => part?.type === "text");
  if (firstTextIndex < 0) return [{ type: "text", text: prompt }, ...content];
  return content.map((part, index) => (index === firstTextIndex ? { ...part, text: prompt } : part));
}

function defaultPrompt(type) {
  if (type === "image") return "请分析这张图片，提取关键内容并回答用户的问题。";
  if (type === "file") return "请阅读并分析这个附件，提取关键信息并回答用户的问题。";
  if (type === "voice") return "请根据这段语音转写内容回答用户的问题。";
  return "请分析这条消息。";
}

async function createSingleMessageContent(message, options) {
  const type = messageType(message);
  const maxBytes = positiveNumber(options.maxMediaBytes, DEFAULT_MAX_MEDIA_BYTES);
  const maxFileTextChars = positiveNumber(options.maxFileTextChars, DEFAULT_MAX_FILE_TEXT_CHARS);
  const filePartType = firstString(options.filePartType, DEFAULT_FILE_PART_TYPE).toLowerCase();

  if (type === "text") {
    const question = captionFromMessage(message);
    return {
      kind: "text",
      question,
      userContent: question,
      historyLabel: "",
      defaultQuestion: "",
    };
  }

  if (type === "image") {
    const descriptor = descriptorFor(message);
    const source = await resolveMedia(descriptor, { mediaClient: options.mediaClient, maxBytes });
    const question = captionFromMessage(message);
    const prompt = question || defaultPrompt(type);
    const mimeType = descriptor.mimeType.startsWith("image/")
      ? descriptor.mimeType
      : mimeTypeForFilename(descriptor.filename, "image/jpeg");
    return {
      kind: type,
      question,
      defaultQuestion: defaultPrompt(type),
      userContent: imageContent(prompt, { ...source, mimeType: source.mimeType?.startsWith("image/") ? source.mimeType : mimeType }),
      historyLabel: "图片",
    };
  }

  if (type === "file") {
    const descriptor = descriptorFor(message);
    const source = await resolveMedia(descriptor, { mediaClient: options.mediaClient, maxBytes });
    const filename = safeFilename(descriptor.filename || source.filename, "attachment");
    const mimeType = mimeTypeForFilename(filename, source.mimeType || descriptor.mimeType || "application/octet-stream");
    const question = captionFromMessage(message);
    const prompt = question || defaultPrompt(type);
    if (source.bytes && isTextFile({ filename, mimeType })) {
      const decoded = decodeText(source.bytes, maxFileTextChars);
      const suffix = decoded.truncated ? "\n\n[附件内容已按长度限制截断]" : "";
      return {
        kind: type,
        question,
        defaultQuestion: defaultPrompt(type),
        userContent: `${prompt}\n\n附件文件名：${filename}\n附件内容：\n${decoded.text}${suffix}`,
        historyLabel: `附件 ${filename}`,
      };
    }
    if (!["file", "input_file"].includes(filePartType)) {
      throw new UserMessageError("当前未启用文件输入格式", "FILE_PART_DISABLED");
    }
    return {
      kind: type,
      question,
      defaultQuestion: defaultPrompt(type),
      userContent: fileContent(prompt, { ...source, mimeType }, filename, filePartType),
      historyLabel: `附件 ${filename}`,
    };
  }

  if (type === "voice") {
    const recognition = recognitionFromMessage(message);
    if (recognition) {
      return {
        kind: type,
        question: recognition,
        defaultQuestion: defaultPrompt(type),
        userContent: recognition,
        historyLabel: "语音转写",
      };
    }

    const descriptor = descriptorFor(message);
    if (descriptor.mediaId || descriptor.url || descriptor.data) {
      const source = await resolveMedia(descriptor, { mediaClient: options.mediaClient, maxBytes });
      if (typeof options.transcribeAudio === "function") {
        try {
          const transcription = await options.transcribeAudio({
            bytes: source.bytes,
            mimeType: normalizeMimeType(source.mimeType, descriptor.mimeType || "audio/mpeg"),
            filename: safeFilename(descriptor.filename || source.filename, "voice.audio"),
          });
          if (transcription) {
            return {
              kind: type,
              question: transcription,
              defaultQuestion: defaultPrompt(type),
              userContent: transcription,
              historyLabel: "语音转写",
            };
          }
        } catch (error) {
          throw new UserMessageError("语音转写服务暂时不可用", "VOICE_TRANSCRIPTION_FAILED");
        }
      }
    }
    throw new UserMessageError(
      "这条语音没有可用的文字识别结果。请在企业微信开启语音识别，或配置 CODEX_TRANSCRIPTION_MODEL。",
      "VOICE_TRANSCRIPTION_UNAVAILABLE",
    );
  }

  throw new UserMessageError(`暂不支持 ${type || "未知"} 类型的消息`, "MESSAGE_TYPE_UNSUPPORTED");
}

async function createMixedMessageContent(message, options) {
  const payload = message?.mixed;
  const items = Array.isArray(payload) ? payload : payload?.msg_item || payload?.items || [];
  if (!items.length) throw new UserMessageError("混合消息没有可读取的内容", "MIXED_CONTENT_MISSING");

  const parts = [];
  for (const item of items) {
    const type = String(item?.msgtype || item?.type || item?.msg_type || "").toLowerCase();
    const normalized = item?.msgtype ? item : { msgtype: type, [type]: item?.[type] || item };
    parts.push(await createSingleMessageContent(normalized, options));
  }

  const textPrompts = parts.map((part) => part.question).filter(Boolean);
  const attachments = parts.flatMap((part) => (
    Array.isArray(part.userContent) ? part.userContent.filter((content) => content.type !== "text") : []
  ));
  const prompt = textPrompts.join("\n") || "请分析这条混合消息中的所有内容。";
  return {
    kind: "mixed",
    question: textPrompts.join("\n"),
    defaultQuestion: "请分析这条混合消息中的所有内容。",
    userContent: attachments.length ? [{ type: "text", text: prompt }, ...attachments] : prompt,
    historyLabel: "混合消息",
  };
}

export async function createMessageContent(message, options = {}) {
  const mediaClient = options.mediaClient || createWeComMediaClient({ maxBytes: options.maxMediaBytes });
  const resolvedOptions = { ...options, mediaClient };
  if (messageType(message) === "mixed") return createMixedMessageContent(message, resolvedOptions);
  return createSingleMessageContent(message, resolvedOptions);
}
