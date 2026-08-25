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

test("ordinary mentioned questions still use DeepSeek by default", () => {
  assert.deepEqual(selectProvider("@AI 你现在支持什么", "deepseek"), {
    provider: "deepseek",
    question: "你现在支持什么",
  });
});
