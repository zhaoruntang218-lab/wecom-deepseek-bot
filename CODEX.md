# Codex-compatible provider

This bot uses the Codex-compatible API for every message. Add the variables
below in Railway, then mention the bot in the enterprise WeCom group:

```dotenv
CODEX_API_KEY=your-provider-key
CODEX_BASE_URL=https://www.speedyapi.best/v1
CODEX_MODEL=gpt-5.6-terra
CODEX_REASONING_EFFORT=xhigh
```

The provider is called through the OpenAI-compatible
`POST /v1/chat/completions` endpoint. The API key must be added only in Railway
Variables; never commit it to Git or paste it into a chat.

The bot removes a leading `@AI` mention before parsing the optional command.
Both ordinary questions and the following forms use Codex:

- `@AI 你的问题`
- `@AI codex 你的问题`
- `@AI /codex 你的问题`
