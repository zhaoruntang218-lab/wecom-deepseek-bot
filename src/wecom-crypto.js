import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const BLOCK_SIZE = 32;

function aesKeyFromEncodingKey(encodingAESKey) {
  if (!encodingAESKey) throw new Error("WECOM_ENCODING_AES_KEY is required");
  const key = Buffer.from(`${encodingAESKey}=`, "base64");
  if (key.length !== 32) {
    throw new Error("WECOM_ENCODING_AES_KEY must decode to 32 bytes");
  }
  return { key, iv: key.subarray(0, 16) };
}

function pkcs7Pad(input) {
  const amount = BLOCK_SIZE - (input.length % BLOCK_SIZE || BLOCK_SIZE);
  return Buffer.concat([input, Buffer.alloc(amount, amount)]);
}

function pkcs7Unpad(input) {
  if (input.length === 0) throw new Error("Invalid encrypted message");
  const amount = input[input.length - 1];
  if (amount < 1 || amount > BLOCK_SIZE || amount > input.length) {
    throw new Error("Invalid PKCS#7 padding");
  }
  for (const value of input.subarray(input.length - amount)) {
    if (value !== amount) throw new Error("Invalid PKCS#7 padding");
  }
  return input.subarray(0, input.length - amount);
}

export function calculateSignature(token, timestamp, nonce, encrypted) {
  return createHash("sha1")
    .update([token, timestamp, nonce, encrypted].sort().join(""))
    .digest("hex");
}

export function verifySignature(token, timestamp, nonce, encrypted, signature) {
  if (!signature) return false;
  const expected = calculateSignature(token, timestamp, nonce, encrypted);
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(String(signature), "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function encryptMessage(encodingAESKey, message, receiveId = "") {
  const { key, iv } = aesKeyFromEncodingKey(encodingAESKey);
  const content = Buffer.from(String(message), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(content.length, 0);
  const plaintext = pkcs7Pad(
    Buffer.concat([randomBytes(16), length, content, Buffer.from(receiveId, "utf8")]),
  );
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]).toString("base64");
}

export function decryptMessage(encodingAESKey, encrypted, expectedReceiveId = "") {
  const { key, iv } = aesKeyFromEncodingKey(encodingAESKey);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  const decrypted = pkcs7Unpad(
    Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]),
  );
  if (decrypted.length < 20) throw new Error("Invalid decrypted message");

  const messageLength = decrypted.readUInt32BE(16);
  const messageStart = 20;
  const messageEnd = messageStart + messageLength;
  if (messageEnd > decrypted.length) throw new Error("Invalid message length");

  const message = decrypted.subarray(messageStart, messageEnd).toString("utf8");
  const receiveId = decrypted.subarray(messageEnd).toString("utf8");
  if (expectedReceiveId && receiveId !== expectedReceiveId) {
    throw new Error("ReceiveId mismatch");
  }
  return message;
}

export function createEncryptedReply(token, encodingAESKey, message, receiveId = "") {
  const encrypt = encryptMessage(encodingAESKey, message, receiveId);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(8).toString("hex");
  return {
    encrypt,
    msgsignature: calculateSignature(token, timestamp, nonce, encrypt),
    timestamp: Number(timestamp),
    nonce,
  };
}
