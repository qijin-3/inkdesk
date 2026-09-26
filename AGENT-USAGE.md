# Local Agent usage

Settings → 模型 → Agent 使用统计. Filter by Agent and last 7/30/90 local calendar days; switch the daily chart between calls, unique conversations and reported tokens. The per-Agent table covers the selected date window.

- A call begins when AsIde attempts to spawn a writing CLI. Preflight validation and model discovery do not count.
- Success, failure, cancellation, timeout and interruption remain recorded. Test connections are counted separately and excluded from writing totals/tokens.
- Conversations deduplicate `(account, articleId, conversationId)`. The same conversation across two Agents counts once overall and once for each participating Agent. Daily unique counts need not sum to period unique counts.
- Records start with this version. No estimated backfill or external CLI usage is included.
- Data is stored separately in the app data directory's `agent-usage.jsonl`, independent of editable workspace state and vault changes. Only call metadata and returned usage numbers are stored, never prompts, responses, credentials or raw CLI diagnostics. The first/last event design preserves failed and interrupted calls across restart.
- Codex uses `exec --json` terminal usage. Claude uses `--output-format json` result usage, not the duplicate modelUsage summary. OpenCode sums unique step_finish events. Cursor reads stream-json result usage when present; Antigravity and ZCode read JSON usage when present. Unsupported/missing totals stay unknown, never zero or an estimate. No subscription balance or monetary cost is inferred.
- Codex cache reads are included in input_tokens; Claude cache reads/writes are additive; OpenCode step tokens include separate cache and reasoning components. Explicit total values take precedence. Other providers require an explicit total to avoid guessing cache semantics.

Protocol references: installed CLI help; https://code.claude.com/docs/en/headless ; https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/cli/cmd/run.ts ; https://antigravity.google/docs/cli/headless/ .

Verification: fixture-based output parsing, actual local mock-process success/failure/cancel, durable aggregation, date boundaries, UI chart/filter tests and packaged app checks. No paid production inference is required for these tests.
