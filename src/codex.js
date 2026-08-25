const DEFAULT_BASE_URL = "https://www.speedyapi.best/v1";

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, stop: () => clearTimeout(timer) };
}

export async function askCodex({
  apiKey,
  baseUrl,
  model,
  reasoningEffort,
  systemPrompt,
  history,
  question,
}) {
  if (!apiKey) throw new Error("CODEX_API_KEY is not configured");

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: question },
  ];
  const timeout = withTimeout(120_000);
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
    const answer = body?.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) {
      throw new Error("Codex returned an empty answer");
    }
    return answer.trim();
  } finally {
    timeout.stop();
  }
}
