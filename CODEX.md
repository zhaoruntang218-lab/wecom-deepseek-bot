# Codex-compatible provider

The bot keeps DeepSeek as the default provider. Add the optional variables below
in Railway, then mention the bot and send `/codex your question` in the
enterprise WeCom group:

```dotenv
CODEX_API_KEY=your-provider-key
CODEX_BASE_URL=https://www.speedyapi.best/v1
CODEX_MODEL=gpt-5.6-terra
CODEX_REASONING_EFFORT=xhigh
BOT_DEFAULT_PROVIDER=deepseek
```

The provider is called through the OpenAI-compatible
`POST /v1/chat/completions` endpoint. The API key must be added only in Railway
Variables; never commit it to Git or paste it into a chat.

The bot removes a leading `@AI` mention before parsing the command, so both
`@AI /codex your question` and `/codex your question` (when the platform sends
the command after mention filtering) are supported.

To route every message to the Codex-compatible provider, set
`BOT_DEFAULT_PROVIDER=codex`. To keep the current behavior, leave it as
`deepseek` and use the `/codex` prefix for selected questions.
