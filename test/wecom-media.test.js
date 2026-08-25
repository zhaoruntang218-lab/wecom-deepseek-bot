import test from "node:test";
import assert from "node:assert/strict";
import { createWeComMediaClient, WeComMediaError } from "../src/wecom-media.js";

test("WeCom media client gets a token and downloads media", async () => {
  const requests = [];
  const client = createWeComMediaClient({
    corpId: "corp-id",
    corpSecret: "corp-secret",
    apiBaseUrl: "https://api.example.test/cgi-bin",
    fetchImpl: async (url) => {
      requests.push(String(url));
      if (String(url).includes("gettoken")) {
        return new Response(JSON.stringify({ errcode: 0, access_token: "token", expires_in: 7200 }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(Buffer.from("image-bytes"), {
        headers: {
          "content-type": "image/png",
          "content-disposition": 'attachment; filename="photo.png"',
        },
      });
    },
  });

  const media = await client.downloadMedia("media-123");
  assert.equal(media.mimeType, "image/png");
  assert.equal(media.filename, "photo.png");
  assert.equal(media.bytes.toString(), "image-bytes");
  assert.equal(requests.length, 2);
  assert.match(requests[1], /media_id=media-123/);
});

test("WeCom media client rejects downloads above its configured byte limit", async () => {
  const client = createWeComMediaClient({
    maxBytes: 4,
    fetchImpl: async () => new Response(Buffer.from("more-than-four"), {
      headers: { "content-type": "image/png" },
    }),
  });

  await assert.rejects(
    client.fetchUrl("https://media.example.test/image.png"),
    (error) => error instanceof WeComMediaError && error.code === "MEDIA_TOO_LARGE",
  );
});
