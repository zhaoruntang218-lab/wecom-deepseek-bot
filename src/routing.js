export function stripLeadingMentions(value) {
  return String(value || "")
    .trim()
    .replace(/^(?:@[^\s/]+\s*)+/u, "")
    .trim();
}

export function selectProvider(value, defaultProvider = "deepseek") {
  const question = stripLeadingMentions(value);
  const match = question.match(/^(?:\/codex|codex:)\s*/i);
  if (match) return { provider: "codex", question: question.slice(match[0].length).trim() };
  return {
    provider: defaultProvider === "codex" ? "codex" : "deepseek",
    question,
  };
}
