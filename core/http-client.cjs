async function* sseLines(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      yield line;
    }
  }
  if (buf.trim()) yield buf;
}

async function httpError(res) {
  let detail = "";
  try {
    detail = (await res.text()).trim().replace(/\s+/g, " ").slice(0, 240);
  } catch {}
  return new Error(detail ? `HTTP ${res.status}：${detail}` : `HTTP ${res.status}`);
}

async function runOpenAI({ baseURL, apiKey, model, messages, signal, onEvent, timeoutMs = 120000 }) {
  const key = String(apiKey || "").trim();
  const url = String(baseURL || "https://api.openai.com/v1").replace(/\/$/, "") + "/chat/completions";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const bodyBase = { model: String(model || "").trim(), messages };
  const doFetch = async (stream) =>
    fetch(url, {
      method: "POST",
      signal: signal || ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      // ponytail: 部分国内兼容端不认 stream_options，失败时降级为非流式
      body: JSON.stringify(
        stream
          ? { ...bodyBase, stream: true, stream_options: { include_usage: true } }
          : { ...bodyBase, stream: false },
      ),
    });
  try {
    let res = await doFetch(true);
    if (!res.ok || !res.body) res = await doFetch(false);
    if (!res.ok) throw await httpError(res);
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text/event-stream")) {
      let text = "",
        usage = null;
      for await (const line of sseLines(res)) {
        const s = line.trim();
        if (!s.startsWith("data:")) continue;
        const payload = s.slice(5).trim();
        if (payload === "[DONE]") break;
        try {
          const j = JSON.parse(payload);
          const d = j.choices?.[0]?.delta?.content || "";
          if (d) {
            text += d;
            onEvent?.({ type: "text_delta", text: d });
          }
          const tc = j.choices?.[0]?.delta?.tool_calls;
          if (tc)
            for (const c of tc)
              onEvent?.({
                type: "tool_update",
                tool: { id: c.id, name: c.function?.name, argsDelta: c.function?.arguments },
              });
          if (j.usage)
            usage = {
              input: j.usage.prompt_tokens ?? null,
              output: j.usage.completion_tokens ?? null,
            };
        } catch {}
      }
      onEvent?.({ type: "usage", usage });
      return { text, usage };
    }
    const j = await res.json();
    const text = j.choices?.[0]?.message?.content || "";
    if (text) onEvent?.({ type: "text_delta", text });
    const usage = j.usage
      ? { input: j.usage.prompt_tokens ?? null, output: j.usage.completion_tokens ?? null }
      : null;
    if (usage) onEvent?.({ type: "usage", usage });
    return { text, usage };
  } finally {
    clearTimeout(t);
  }
}

async function runAnthropic({ baseURL, apiKey, model, messages, system, signal, onEvent, timeoutMs = 120000 }) {
  const key = String(apiKey || "").trim();
  const url = String(baseURL || "https://api.anthropic.com").replace(/\/$/, "") + "/v1/messages";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: signal || ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        Authorization: "Bearer " + key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens: 4096, system, messages, stream: true }),
    });
    if (!res.ok) throw await httpError(res);
    let text = "",
      usage = null;
    for await (const line of sseLines(res)) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      try {
        const j = JSON.parse(s.slice(5).trim());
        if (j.type === "content_block_delta" && j.delta?.text) {
          text += j.delta.text;
          onEvent?.({ type: "text_delta", text: j.delta.text });
        }
        if (j.type === "message_stop" && j.usage)
          usage = {
            input: j.usage.input_tokens ?? null,
            output: j.usage.output_tokens ?? null,
          };
      } catch {}
    }
    if (usage) onEvent?.({ type: "usage", usage });
    return { text, usage };
  } finally {
    clearTimeout(t);
  }
}
module.exports = { runOpenAI, runAnthropic };
