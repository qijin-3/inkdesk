const { spawn } = require('node:child_process');
function parseModelLines(text) {
  return [...new Set(String(text || '').replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).flatMap(line => {
    const m = line.trim().match(/^([a-z0-9][a-z0-9_./:@+-]*(?:\[[^\]]+\])?)(?:\s+[-–—]\s+.*)?$/);
    return m && (/[\/-]/.test(m[1]) || ['auto','sonnet','opus','haiku','fable','best'].includes(m[1])) ? [m[1]] : [];
  }))];
}
// Only initialize and list models; never opens a thread or starts an inference turn.
function codexModels(exe, env, { spawnImpl = spawn, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let child, buffer = '', done = false, requestId = 1, pages = 0;
    const models = [], cursors = new Set();
    const finish = (error) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (child) { child.stdin.end(); child.kill('SIGTERM'); }
      error ? reject(error) : resolve([...new Set(models)]);
    };
    const timer = setTimeout(() => finish(new Error('模型查询超时，请检查 CLI 登录或网络后刷新')), timeoutMs);
    const send = (message) => child.stdin.write(JSON.stringify(message) + '\n');
    const list = (cursor) => send({ id: ++requestId, method: 'model/list', params: { limit: 100, includeHidden: false, ...(cursor ? {cursor} : {}) } });
    try {
      child = spawnImpl(exe, ['app-server'], { env, stdio: ['pipe','pipe','pipe'] });
      child.on('error', finish);
      child.stdin.on('error', finish);
      child.stderr.on('data', () => {});
      child.on('close', () => { if (!done) finish(new Error('Codex 在返回模型列表前退出，请检查 CLI 登录状态')); });
      child.stdout.on('data', chunk => {
        buffer += chunk.toString();
        if (buffer.length > 2e6) return finish(new Error('模型查询响应过大'));
        let newline;
        while (!done && (newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0,newline); buffer = buffer.slice(newline+1);
          let message; try { message = JSON.parse(line); } catch { continue; }
          if (message.id !== requestId) continue;
          if (message.error) return finish(new Error(message.error.message || 'Codex 模型查询失败'));
          if (requestId === 1) { send({method:'initialized'}); list(); continue; }
          if (!Array.isArray(message.result?.data)) return finish(new Error('Codex 模型响应格式不兼容'));
          models.push(...message.result.data.filter(m => !m.hidden).map(m => m.model || m.id).filter(m => typeof m === 'string' && m));
          const cursor = message.result.nextCursor;
          if (!cursor) return finish();
          if (++pages > 50 || cursors.has(cursor)) return finish(new Error('模型列表分页异常'));
          cursors.add(cursor); list(cursor);
        }
      });
      send({id:1,method:'initialize',params:{clientInfo:{name:'aside',version:'0.2.3'}}});
    } catch (error) { finish(error); }
  });
}
module.exports = { parseModelLines, codexModels };
