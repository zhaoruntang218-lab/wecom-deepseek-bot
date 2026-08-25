const DEFAULT_BASE_URL = "https://www.speedyapi.best/v1";

function withTimeout(ms) {
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(Number(ms)) && Number(ms) > 0 ? Number(ms) : 120_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, stop: () => clearTimeout(timer) };
}

function answerText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part === "string" ? part : part?.text || part?.output_text || ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

export async function askCodex({
  apiKey,
  baseUrl,
  model,
  reasoningEffort,
  systemPrompt,
  history,
  question,
  userContent,
  timeoutMs,
}) {
  if (!apiKey) throw new Error("CODEX_API_KEY is not configured");

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userContent || question },
  ];
  const timeout = withTimeout(timeoutMs);
  try {
    const payload = {
      model: model || "gpt-5.6-terra",
      messages,
    };
    if (reasoningEffort) payload.reasoning_effort = reasoningEffort;

    const response = await fetch(`${(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: timeout.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = body?.error?.message || body?.message || `HTTP ${response.status}`;
      throw new Error(`Codex request failed: ${detail}`);
    }
    const answer = answerText(body?.choices?.[0]?.message?.content);
    if (!answer) {
      throw new Error("Codex returned an empty answer");
    }
    return answer;
  } finally {
    timeout.stop();
  }
}

export async function transcribeAudio({
  apiKey,
  baseUrl,
  model = "gpt-4o-mini-transcribe",
  bytes,
  filename = "voice.audio",
  mimeType = "application/octet-stream",
  timeoutMs,
}) {
  if (!apiKey) throw new Error("CODEX_API_KEY is not configured");
  if (!bytes?.length) throw new Error("Audio content is empty");
  if (typeof FormData === "undefined" || typeof Blob === "undefined") {
    throw new Error("当前 Node.js 不支持音频上传");
  }

  const form = new FormData();
  form.append("model", model);
  form.append("file", new Blob([bytes], { type: mimeType }), filename);
  const timeout = withTimeout(timeoutMs);
  try {
    const response = await fetch(`${(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: timeout.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = body?.error?.message || body?.message || `HTTP ${response.status}`;
      throw new Error(`Codex transcription failed: ${detail}`);
    }
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) throw new Error("Codex transcription returned an empty result");
    return text;
  } finally {
    timeout.stop();
  }
}
