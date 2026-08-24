import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateSignature,
  createEncryptedReply,
  decryptMessage,
  encryptMessage,
  verifySignature,
} from "../src/wecom-crypto.js";

const token = "test-token";
const encodingAESKey = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG".slice(0, 43);

test("encrypt/decrypt round trip preserves receive id", () => {
  const encrypted = encryptMessage(encodingAESKey, JSON.stringify({ text: "你好" }), "bot-id");
  assert.equal(decryptMessage(encodingAESKey, encrypted, "bot-id"), JSON.stringify({ text: "你好" }));
  assert.throws(() => decryptMessage(encodingAESKey, encrypted, "other-bot"), /ReceiveId mismatch/);
});

test("signatures are deterministic and reject tampering", () => {
  const signature = calculateSignature(token, "1700000000", "nonce", "ciphertext");
  assert.equal(verifySignature(token, "1700000000", "nonce", "ciphertext", signature), true);
  assert.equal(verifySignature(token, "1700000000", "nonce", "changed", signature), false);
});

test("encrypted reply has the callback fields", () => {
  const reply = createEncryptedReply(token, encodingAESKey, "success");
  assert.equal(decryptMessage(encodingAESKey, reply.encrypt), "success");
  assert.equal(
    verifySignature(token, String(reply.timestamp), reply.nonce, reply.encrypt, reply.msgsignature),
    true,
  );
});
