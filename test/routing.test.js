import test from "node:test";
import assert from "node:assert/strict";
import { selectProvider, stripLeadingMentions } from "../src/routing.js";

test("leading WeCom mentions are removed before routing", () => {
  assert.equal(stripLeadingMentions("@AI /codex 请介绍自己"), "/codex 请介绍自己");
  assert.deepEqual(selectProvider("@AI /codex 请介绍自己"), {
    provider: "codex",
    question: "请介绍自己",
  });
});

test("codex command accepts common spellings", () => {
  for (const input of ["@AI codex 你好", "@AI /codex 你好", "@AI codex: 你好", "@AI / codex：你好"]) {
    assert.deepEqual(selectProvider(input), { provider: "codex", question: "你好" });
  }
});

test("ordinary mentioned questions use Codex by default", () => {
  assert.deepEqual(selectProvider("@AI 你现在支持什么"), {
    provider: "codex",
    question: "你现在支持什么",
  });
});
