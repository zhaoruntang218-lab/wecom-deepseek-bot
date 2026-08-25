import test from "node:test";
import assert from "node:assert/strict";
import { createMessageContent, replaceContentPrompt, UserMessageError } from "../src/message-content.js";

test("image messages become an OpenAI-compatible image content part", async () => {
  const content = await createMessageContent({
    msgtype: "image",
    image: { base64: Buffer.from("image-bytes").toString("base64"), mime_type: "image/png" },
  });

  assert.equal(content.kind, "image");
  assert.equal(content.question, "");
  assert.equal(content.userContent[0].type, "text");
  assert.equal(content.userContent[1].type, "image_url");
  assert.match(content.userContent[1].image_url.url, /^data:image\/png;base64,/);
});

test("WeCom signed image URLs are downloaded and embedded without corp credentials", async () => {
  const content = await createMessageContent({
    msgtype: "image",
    image: { url: "https://media.example.test/signed-image" },
  }, {
    mediaClient: {
      fetchUrl: async () => ({
        bytes: Buffer.from("image-bytes"),
        mimeType: "image/jpeg",
        filename: "image.jpg",
      }),
    },
  });

  assert.match(content.userContent[1].image_url.url, /^data:image\/jpeg;base64,/);
});

test("mixed group messages keep the text prompt and image URL together", async () => {
  const content = await createMessageContent({
    msgtype: "mixed",
    mixed: {
      msg_item: [
        { msgtype: "text", text: { content: "@AI 这张图是什么" } },
        { msgtype: "image", image: { url: "https://media.example.test/group-image" } },
      ],
    },
  }, {
    mediaClient: {
      fetchUrl: async () => ({
        bytes: Buffer.from("group-image"),
        mimeType: "image/jpeg",
        filename: "image.jpg",
      }),
    },
  });

  assert.equal(content.kind, "mixed");
  assert.equal(content.question, "@AI 这张图是什么");
  assert.equal(content.userContent[0].type, "text");
  assert.equal(content.userContent[1].type, "image_url");
  assert.match(content.userContent[1].image_url.url, /^data:image\/jpeg;base64,/);
});

test("text attachments are extracted before the Codex request", async () => {
  const content = await createMessageContent({
    msgtype: "file",
    file: {
      name: "notes.md",
      mime_type: "text/markdown",
      base64: Buffer.from("# Title\nImportant details").toString("base64"),
      question: "/codex 总结一下",
    },
  });

  assert.equal(content.kind, "file");
  assert.equal(content.question, "/codex 总结一下");
  assert.match(content.userContent, /附件文件名：notes\.md/);
  assert.match(content.userContent, /Important details/);
  assert.match(replaceContentPrompt(content.userContent, "总结一下"), /^总结一下\n\n附件文件名：/);
});

test("voice recognition from WeCom is used without uploading audio", async () => {
  const content = await createMessageContent({
    msgtype: "voice",
    voice: { content: "明天上海天气怎么样" },
  });

  assert.equal(content.kind, "voice");
  assert.equal(content.userContent, "明天上海天气怎么样");
});

test("media_id reports a setup error when the media client has no credentials", async () => {
  await assert.rejects(
    createMessageContent({ msgtype: "image", image: { media_id: "media-id" } }),
    (error) => error instanceof UserMessageError && error.code === "MEDIA_CREDENTIALS_MISSING",
  );
});

test("binary files use the configured file content part", async () => {
  const content = await createMessageContent({
    msgtype: "file",
    file: {
      name: "report.pdf",
      mime_type: "application/pdf",
      base64: Buffer.from("pdf-bytes").toString("base64"),
    },
  }, { filePartType: "input_file" });

  assert.equal(content.userContent[1].type, "input_file");
  assert.equal(content.userContent[1].filename, "report.pdf");
  assert.match(content.userContent[1].file_data, /^data:application\/pdf;base64,/);
});
