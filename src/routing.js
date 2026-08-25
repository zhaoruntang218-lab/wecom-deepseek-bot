export function stripLeadingMentions(value) {
  return String(value || "")
    .trim()
    .replace(/^(?:@[^\s/]+\s*)+/u, "")
    .trim();
}

export function selectProvider(value) {
  const question = stripLeadingMentions(value);
  const codexMatch = question.match(/^(?:\/\s*)?codex(?:(?:\s*[:：])|\s+|$)\s*/i);
  if (codexMatch) {
    return { provider: "codex", question: question.slice(codexMatch[0].length).trim() };
  }
  return { provider: "codex", question };
}
