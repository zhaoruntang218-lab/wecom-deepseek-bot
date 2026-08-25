# Codex-compatible provider

This bot uses the Codex-compatible API for every message. Add the variables
below in Railway, then mention the bot in the enterprise WeCom group:

```dotenv
CODEX_API_KEY=your-provider-key
CODEX_BASE_URL=https://www.speedyapi.best/v1
CODEX_MODEL=gpt-5.6-terra
CODEX_REASONING_EFFORT=xhigh
CODEX_FILE_PART_TYPE=file
CODEX_TRANSCRIPTION_MODEL=
```

The provider is called through the OpenAI-compatible
`POST /v1/chat/completions` endpoint. The API key must be added only in Railway
Variables; never commit it to Git or paste it into a chat.

The bot removes a leading `@AI` mention before parsing the optional command.
Both ordinary questions and the following forms use Codex:

- `@AI 你的问题`
- `@AI codex 你的问题`
- `@AI /codex 你的问题`

## Media inputs

The callback handler also supports image, file, voice, and mixed messages. Add
`WECOM_CORP_ID` and `WECOM_CORP_SECRET` when WeCom sends only a `media_id`; the
service downloads the media through the WeCom media API and keeps it in memory.
Images use an OpenAI-compatible `image_url` part. Text files are extracted
locally, while binary files use `CODEX_FILE_PART_TYPE=file` by default. Set
`CODEX_FILE_PART_TYPE=input_file` only when the provider documents that shape.
Voice messages use WeCom's `content`/recognition field, or an optional
`CODEX_TRANSCRIPTION_MODEL` through `/audio/transcriptions`.
The WeCom `response_url` can be called only once, so the service sends one final
reply after media processing instead of consuming the URL with a progress message.
