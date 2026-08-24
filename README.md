# 企业微信智能机器人 + DeepSeek

这是一个最小可运行的 Node.js 服务，适配截图中的企业微信“智能机器人 → 使用 URL 回调”模式。截图是企业微信后台，不是个人微信普通群聊；个人微信没有同等的官方机器人回调接口，不能直接使用本示例。

1. 企业微信将 AES 加密的 JSON 消息 POST 到 `/wechat/callback`。
2. 服务校验 `msg_signature`，用 Token 和 EncodingAESKey 解密。
3. 服务调用 DeepSeek 的 OpenAI 兼容接口。
4. 服务使用消息里的 `response_url` 回发 Markdown 答案。

## 先处理密钥

你在聊天中粘贴的 DeepSeek Key 已经暴露。请先在 DeepSeek 控制台撤销它并生成新 Key；不要把新 Key 写进代码、截图或 Git，只放在本机 `.env` 或部署平台的 Secret 中。

## 本地运行

需要 Node.js 18.18 或更高版本（内置 `fetch`）。

```bash
pnpm install
copy .env.example .env
# 编辑 .env，填入新 DeepSeek Key、企业微信 Token 和 EncodingAESKey
pnpm start
```

健康检查：`GET http://127.0.0.1:3000/healthz`。

## 最简单的填写方式

`.env` 可以直接按下面的格式填写（API Key 必须换成你重新生成的新 Key）：

```dotenv
DEEPSEEK_API_KEY=你的新DeepSeek_API_Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
WECOM_TOKEN=企业微信页面里的Token
WECOM_ENCODING_AES_KEY=企业微信页面里的43位EncodingAESKey
WECOM_RECEIVE_ID=
PORT=3000
```

企业微信页面的 URL 不能填写 `localhost`、`127.0.0.1` 或电脑内网 IP。部署完成后，假设云服务给你的域名是 `https://my-bot.example.com`，URL 填：

```text
https://my-bot.example.com/wechat/callback
```

不要把 DeepSeek API Key 填到企业微信的 Token 或 EncodingAESKey 输入框里，它们是三组不同的密钥。

## 电脑关机后继续运行

把这个项目部署到云端即可。以支持 Docker 的云服务器为例：

```bash
git clone 你的项目地址
cd New-project-2
docker build -t wecom-deepseek-bot .
docker run -d --name wecom-deepseek-bot --restart unless-stopped \
  -p 3000:3000 \
  -e DEEPSEEK_API_KEY='你的新DeepSeek_API_Key' \
  -e WECOM_TOKEN='企业微信Token' \
  -e WECOM_ENCODING_AES_KEY='企业微信EncodingAESKey' \
  -e DEEPSEEK_MODEL='deepseek-chat' \
  wecom-deepseek-bot
```

云服务器还需要配置 HTTPS 域名（例如 Nginx + Let's Encrypt），然后把 HTTPS 地址填回企业微信。也可以把本项目部署到 Railway、Render 等支持 Docker 的云托管平台，在平台的 Environment Variables 中填写同样的三个密钥，平台提供的 HTTPS 域名就是回调地址。

## 企业微信配置

服务必须部署到企业微信可访问的 HTTPS 地址。将回调 URL 填为：

```text
https://你的域名/wechat/callback
```

截图中的 Token 填入 `WECOM_TOKEN`，Encoding-AESKey 填入 `WECOM_ENCODING_AES_KEY`。点击企业微信的保存/验证后，服务会处理 GET 验证请求。`WECOM_RECEIVE_ID` 对智能机器人通常留空；只有企业微信文档明确要求校验 receiveid 时才设置。

## 部署注意事项

- 本地 `127.0.0.1` 不能作为回调地址；开发测试可用 Cloudflare Tunnel、ngrok 等 HTTPS 隧道。
- 生产环境使用 HTTPS、进程守护和日志脱敏，不打印 API Key、完整回调体或用户隐私。
- `response_url` 由企业微信回调消息提供，服务会立即确认回调，再异步调用 DeepSeek，避免超时重试。
- 当前示例按群聊 ID 保存短期内存上下文，重启后清空；需要持久化时换成 Redis/数据库。
- 回答按企业微信 Markdown 约 4000 字符截断；需要更长内容时应拆成多条消息。

官方文档：

- [企业微信智能机器人对接](https://developer.work.weixin.qq.com/document/path/101521)
- [DeepSeek API 文档](https://api-docs.deepseek.com/)
