const DEFAULT_BASE_URL = "https://api.deepseek.com";

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, stop: () => clearTimeout(timer) };
}

export async function askDeepSeek({ apiKey, baseUrl, model, systemPrompt, history, question }) {
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: question },
  ];
  const timeout = withTimeout(60_000);
  try {
    const response = await fetch(`${(baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: model || "deepseek-chat", messages, temperature: 0.7 }),
      signal: timeout.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = body?.error?.message || `HTTP ${response.status}`;
      throw new Error(`DeepSeek request failed: ${detail}`);
    }
    const answer = body?.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) {
      throw new Error("DeepSeek returned an empty answer");
    }
    return answer.trim();
  } finally {
    timeout.stop();
  }
}
