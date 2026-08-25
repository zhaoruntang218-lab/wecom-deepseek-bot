const DEFAULT_API_BASE_URL = "https://qyapi.weixin.qq.com/cgi-bin";
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export class WeComMediaError extends Error {
  constructor(message, code = "MEDIA_ERROR") {
    super(message);
    this.name = "WeComMediaError";
    this.code = code;
  }
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), positiveNumber(timeoutMs, DEFAULT_TIMEOUT_MS));
  return { signal: controller.signal, stop: () => clearTimeout(timer) };
}

function parseContentLength(headers) {
  const value = Number(headers?.get?.("content-length") || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function readLimitedBytes(response, maxBytes) {
  const declaredLength = parseContentLength(response.headers);
  if (declaredLength > maxBytes) {
    throw new WeComMediaError(`媒体超过 ${maxBytes} 字节大小限制`, "MEDIA_TOO_LARGE");
  }

  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) {
      throw new WeComMediaError(`媒体超过 ${maxBytes} 字节大小限制`, "MEDIA_TOO_LARGE");
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new WeComMediaError(`媒体超过 ${maxBytes} 字节大小限制`, "MEDIA_TOO_LARGE");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total);
}

function parseFilename(contentDisposition) {
  if (!contentDisposition) return "";
  const encoded = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.replace(/^"|"$/g, ""));
    } catch {
      return encoded.replace(/^"|"$/g, "");
    }
  }
  return contentDisposition.match(/filename\s*=\s*"?([^";]+)"?/i)?.[1] || "";
}

function errorFromJson(body, fallback) {
  if (body && Number(body.errcode) !== 0) {
    return new WeComMediaError(`${fallback}: ${body.errmsg || `errcode ${body.errcode}`}`, "WECOM_API_ERROR");
  }
  return new WeComMediaError(fallback, "MEDIA_ERROR");
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function normalizeMimeType(value, fallback = "application/octet-stream") {
  const mimeType = String(value || "").split(";", 1)[0].trim().toLowerCase();
  return /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(mimeType) ? mimeType : fallback;
}

export function createWeComMediaClient({
  corpId = "",
  corpSecret = "",
  apiBaseUrl = DEFAULT_API_BASE_URL,
  maxBytes = DEFAULT_MAX_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedMaxBytes = positiveNumber(maxBytes, DEFAULT_MAX_BYTES);
  const normalizedTimeoutMs = positiveNumber(timeoutMs, DEFAULT_TIMEOUT_MS);
  const baseUrl = String(apiBaseUrl || DEFAULT_API_BASE_URL).replace(/\/$/, "");
  let tokenCache = null;

  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for the WeCom media client");
  }

  async function getAccessToken(forceRefresh = false) {
    if (!corpId || !corpSecret) {
      throw new WeComMediaError(
        "读取企业微信媒体需要配置 WECOM_CORP_ID 和 WECOM_CORP_SECRET",
        "MEDIA_CREDENTIALS_MISSING",
      );
    }
    if (!forceRefresh && tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
      return tokenCache.value;
    }

    const timeout = timeoutSignal(normalizedTimeoutMs);
    try {
      const url = `${baseUrl}/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(corpSecret)}`;
      const response = await fetchImpl(url, { signal: timeout.signal });
      const body = await parseJsonResponse(response);
      if (!response.ok || !body || Number(body.errcode) !== 0 || !body.access_token) {
        throw errorFromJson(body, `企业微信 access_token 获取失败 (HTTP ${response.status})`);
      }
      const expiresIn = positiveNumber(body.expires_in, 7200);
      tokenCache = { value: body.access_token, expiresAt: Date.now() + expiresIn * 1000 };
      return tokenCache.value;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new WeComMediaError("企业微信 access_token 请求超时", "MEDIA_TIMEOUT");
      }
      throw error;
    } finally {
      timeout.stop();
    }
  }

  async function fetchBytes(url, { filename = "", mediaId = "" } = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      throw new WeComMediaError("媒体地址必须使用 HTTPS", "MEDIA_URL_INVALID");
    }
    const timeout = timeoutSignal(normalizedTimeoutMs);
    try {
      const response = await fetchImpl(parsed, { signal: timeout.signal });
      if (!response.ok) {
        throw new WeComMediaError(`媒体下载失败 (HTTP ${response.status})`, "MEDIA_DOWNLOAD_FAILED");
      }
      const bytes = await readLimitedBytes(response, normalizedMaxBytes);
      const contentType = normalizeMimeType(response.headers?.get?.("content-type"));
      return {
        bytes,
        bytesLength: bytes.length,
        mimeType: contentType,
        filename: filename || parseFilename(response.headers?.get?.("content-disposition")),
        mediaId,
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new WeComMediaError("媒体下载超时", "MEDIA_TIMEOUT");
      }
      throw error;
    } finally {
      timeout.stop();
    }
  }

  async function fetchUrl(url, options = {}) {
    return fetchBytes(url, options);
  }

  async function downloadMedia(mediaId, options = {}) {
    const normalizedMediaId = String(mediaId || "").trim();
    if (!normalizedMediaId) {
      throw new WeComMediaError("缺少企业微信 media_id", "MEDIA_ID_MISSING");
    }

    let token = await getAccessToken();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const url = `${baseUrl}/media/get?access_token=${encodeURIComponent(token)}&media_id=${encodeURIComponent(normalizedMediaId)}`;
      const timeout = timeoutSignal(normalizedTimeoutMs);
      try {
        const response = await fetchImpl(url, { signal: timeout.signal });
        const contentType = response.headers?.get?.("content-type") || "";
        if (!response.ok) {
          if (attempt === 0 && response.status === 401) {
            token = await getAccessToken(true);
            continue;
          }
          throw new WeComMediaError(`企业微信媒体下载失败 (HTTP ${response.status})`, "MEDIA_DOWNLOAD_FAILED");
        }
        const bytes = await readLimitedBytes(response, normalizedMaxBytes);
        if (/json/i.test(contentType)) {
          let body = null;
          try {
            body = JSON.parse(bytes.toString("utf8"));
          } catch {
            // A binary file can have an unusual content type; keep it as media.
          }
          if (body && (body.errcode !== undefined || body.errmsg !== undefined)) {
            if (attempt === 0 && Number(body.errcode) === 42001) {
              token = await getAccessToken(true);
              continue;
            }
            throw errorFromJson(body, "企业微信媒体下载失败");
          }
        }
        return {
          bytes,
          bytesLength: bytes.length,
          mimeType: normalizeMimeType(contentType),
          filename: options.filename || parseFilename(response.headers?.get?.("content-disposition")),
          mediaId: normalizedMediaId,
        };
      } catch (error) {
        if (error?.name === "AbortError") {
          throw new WeComMediaError("企业微信媒体下载超时", "MEDIA_TIMEOUT");
        }
        throw error;
      } finally {
        timeout.stop();
      }
    }
    throw new WeComMediaError("企业微信媒体下载失败", "MEDIA_DOWNLOAD_FAILED");
  }

  return {
    isConfigured: Boolean(corpId && corpSecret),
    maxBytes: normalizedMaxBytes,
    timeoutMs: normalizedTimeoutMs,
    getAccessToken,
    fetchUrl,
    downloadMedia,
  };
}
