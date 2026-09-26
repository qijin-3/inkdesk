# Agent model discovery

Settings → 模型. Provider identity is independent of the selected model: ChatGPT uses the Codex CLI; Claude Code is a separate provider. Switching providers resets the model override to the target CLI default. Saved custom IDs are retained but never silently activated or presented as verified.

- Cursor: `agent --list-models`.
- ChatGPT: Codex app-server stdio `initialize` → `initialized` → paginated `model/list`; does not start a model turn.
- Claude Code: version-independent aliases, with additional aliases discovered from the installed CLI help. This is not an account entitlement query. See https://code.claude.com/docs/en/model-config.
- OpenCode: `opencode models`, with `--refresh` on explicit refresh. Directory entries do not guarantee entitlement. See https://opencode.ai/docs/cli/.
- Antigravity: `agy models`; use the slug column, never display names. See https://antigravity.google/docs/cli/headless/. Not installed on the development machine; parser tested against documented output.
- ZCode: retain the CLI default model; no fabricated model catalog.

Successful catalogs are cached in memory for five minutes. Refresh bypasses the cache; a failure displays an error and preserves the last successful result with a stale marker. No network catalog or CLI error is silently converted into model IDs. Tests of inference are user-triggered only.

Verified 2026-09-26: Cursor, Codex, OpenCode actual catalog calls; Claude local help. `npm test`, `npm run test:agents`, and UI regressions cover parser correctness, RPC pagination/errors/timeouts, names/logos and provider switching.
