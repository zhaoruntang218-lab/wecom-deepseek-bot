# 企业微信智能机器人 + Codex

这是一个部署在 Railway 等云平台上的企业微信智能机器人服务。它接收企业微信智能机器人的加密回调，调用 Codex 兼容的 OpenAI API，并通过企业微信 `response_url` 回复答案。

## 配置

在 Railway Variables 中填写：

```dotenv
CODEX_API_KEY=你的Codex兼容API Key
CODEX_BASE_URL=https://www.speedyapi.best/v1
CODEX_MODEL=gpt-5.6-terra
CODEX_REASONING_EFFORT=xhigh
WECOM_TOKEN=企业微信页面里的Token
WECOM_ENCODING_AES_KEY=企业微信页面里的43位EncodingAESKey
WECOM_RECEIVE_ID=
PORT=3000
MAX_HISTORY_MESSAGES=12
```

不要把 API Key 写入代码、Git、截图或企业微信的 Token 输入框。此前出现在聊天中的 Key 应撤销并重新生成。

## 企业微信回调

部署后，将智能机器人 URL 填为：

```text
https://你的Railway域名/wechat/callback
```

服务必须使用公开 HTTPS 地址，不能填写 `localhost`、`127.0.0.1` 或内网 IP。健康检查地址为 `/healthz`。

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
