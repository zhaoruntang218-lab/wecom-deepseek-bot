# 企业微信智能机器人 + Codex

这是一个部署在 Railway 等云平台上的企业微信智能机器人服务。它接收企业微信智能机器人的加密回调，调用 Codex 兼容的 OpenAI API，并通过企业微信 `response_url` 回复答案。

## 配置

在 Railway Variables 中填写：

```dotenv
CODEX_API_KEY=你的Codex兼容API Key
CODEX_BASE_URL=https://www.speedyapi.best/v1
CODEX_MODEL=gpt-5.6-terra
CODEX_REASONING_EFFORT=xhigh
CODEX_TRANSCRIPTION_MODEL=
CODEX_FILE_PART_TYPE=file
CODEX_TIMEOUT_MS=120000
WECOM_TOKEN=企业微信页面里的Token
WECOM_ENCODING_AES_KEY=企业微信页面里的43位EncodingAESKey
WECOM_RECEIVE_ID=
WECOM_CORP_ID=仅当回调是 media_id 且需要调用企业微信素材接口时填写
WECOM_CORP_SECRET=仅当回调是 media_id 且需要调用企业微信素材接口时填写
PORT=3000
MAX_HISTORY_MESSAGES=12
MAX_MEDIA_BYTES=10485760
MEDIA_FETCH_TIMEOUT_MS=30000
MAX_FILE_TEXT_CHARS=60000
```

不要把 API Key 写入代码、Git、截图或企业微信的 Token 输入框。此前出现在聊天中的 Key 应撤销并重新生成。

## 企业微信回调

部署后，将智能机器人 URL 填为：

```text
https://你的Railway域名/wechat/callback
```

服务必须使用公开 HTTPS 地址，不能填写 `localhost`、`127.0.0.1` 或内网 IP。健康检查地址为 `/healthz`。

## 图片、附件和语音

服务支持企业微信智能机器人回调中的 `image`、`file` 和 `voice` 消息：

- 图片会转换为 OpenAI 兼容的 `image_url` 内容块。企业微信智能机器人传来的临时图片 URL 会先由 Railway 下载，再以内嵌 Base64 发送给 Codex，避免兼容接口无法访问腾讯图片地址；如果你的回调版本只传 `media_id`，再配置 `WECOM_CORP_ID` 和 `WECOM_CORP_SECRET`。
- `txt`、`md`、`csv`、`json`、`xml`、代码等文本附件会在服务端提取文字。PDF、Word、压缩包等二进制附件会按 `CODEX_FILE_PART_TYPE` 发送，前提是你的兼容接口支持对应格式。
- 语音优先使用企业微信提供的 `voice.content`（部分回调版本使用 `recognition`）。没有识别文本时，只有配置 `CODEX_TRANSCRIPTION_MODEL` 才会调用 `/audio/transcriptions`。
- 媒体默认限制为 10 MB，下载超时为 30 秒；可用 `MAX_MEDIA_BYTES` 和 `MEDIA_FETCH_TIMEOUT_MS` 调整。企业微信的 `response_url` 每条回调只能调用一次，因此服务会等待媒体处理后只发送一次最终结果，避免“处理中”提示占用回复机会。

这仍然取决于兼容接口和模型是否真正启用了视觉、文件或音频能力；同一个 API Key 不会自动让企业微信回调具备媒体下载和解析能力。

## 群内使用

当前所有问题都使用 Codex。发送新消息并真实选择机器人提及：

```text
@AI 你好
@AI codex 请只回复：CODEX_OK
@AI /codex 解释一下量子纠缠
```

机器人必须从企业微信的提及列表中选择，不能只手动输入普通文本 `@AI`。服务会移除开头的提及后再调用 API。

## 本地运行

需要 Node.js 18.18 或更高版本：

```bash
pnpm install
copy .env.example .env
pnpm start
```

## 验证与部署

```bash
pnpm test
docker build -t wecom-codex-bot .
```

Railway 会在部署完成后提供 HTTPS 域名。修改 Variables 后需要点击 Deploy，等待服务显示 `Active` 和 `Deployment successful`。

企业微信回调收到消息后，服务会先快速确认，再异步调用 Codex，避免企业微信超时重试。会话历史仅保存在内存中，服务重启后清空。


<!-- Railway branch sync -->


<!-- Railway auto deploy enabled -->
