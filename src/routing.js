export function stripLeadingMentions(value) {
  return String(value || "")
    .trim()
    .replace(/^(?:@[^\s/]+\s*)+/u, "")
    .trim();
}

export function selectProvider(value, defaultProvider = "deepseek") {
  const question = stripLeadingMentions(value);
  const codexMatch = question.match(/^(?:\/\s*)?codex(?:(?:\s*[:：])|\s+|$)\s*/i);
  if (codexMatch) {
    return { provider: "codex", question: question.slice(codexMatch[0].length).trim() };
  }

  const deepSeekMatch = question.match(/^(?:\/\s*)?deepseek(?:(?:\s*[:：])|\s+|$)\s*/i);
  if (deepSeekMatch) {
    return { provider: "deepseek", question: question.slice(deepSeekMatch[0].length).trim() };
  }

  return {
    provider: defaultProvider === "codex" ? "codex" : "deepseek",
    question,
  };
}
