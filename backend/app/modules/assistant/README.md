# assistant module

AI reply drafting with **each user's own API key** (D43): the user connects OpenAI (ChatGPT),
Anthropic (Claude) or Google Gemini, writes a short note, and gets the full reply in their own
style and in the language of the conversation. The draft only lands in the composer; nothing is
sent without the user.

| Layer | Contents |
|---|---|
| domain | `AiProvider`, `AssistantConfig`, `ReplyRequest`/`ReplyDraft`, key shape, default model, quote stripping, budget trimming, text -> safe HTML |
| application | `AssistantService` (connect / choose model / disconnect, drafting), ports `AiGateway`, `ReplyWriter`, `AssistantConfigRepository` |
| infrastructure | `prompt.py` (shared system prompt, data tags, JSON output), `openai_writer.py` and `gemini_writer.py` (REST over HTTPX), `claude_writer.py` (Anthropic SDK), `gateway.py`, `repository.py` (`assistant_configs`) |
| presentation | `/assistant` (GET, PUT, PATCH, DELETE), `/assistant/reply` |

The key is checked with the provider (its model list) before it is stored, then kept only in the
Token Vault (`user_secrets`, AES-256-GCM, bound to the user). `assistant_configs` keeps the
provider, the chosen model, the models the key can use and the key's last four characters.

Context sent to the provider: the conversation up to the replied-to message (quoted parts
removed, newest kept within a character budget), up to five of the user's sent messages from the
same mailbox (to this correspondent first) as style samples, the user's name and address, and
the note. Mail text is escaped and wrapped in data tags; the model has no tools. Provider hosts
are constants. Drafts and key checks are rate limited per user; nothing from the request, the
reply or the key is logged.

**Depends on:** `emails`, `email_accounts`, `users`, `token_vault` (application layers).

**Tenant data:** `assistant_configs` (RLS); the key in `token_vault`'s `user_secrets`.
