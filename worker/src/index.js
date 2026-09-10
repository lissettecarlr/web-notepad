// Cloudflare Workers 后端
// 静态前端由 [assets] 托管（../public），这里只处理 API。
//
// KV 布局：
//   note:<name>        内容；metadata = { version, size, updated }
//   hist:<name>:<ts>   历史快照（最多 HISTORY_KEEP 份）
//   <name>             旧版本的裸 key，首次访问时自动迁移
//
// 注意：KV 是最终一致的，多端并发编辑时冲突检测是"尽力而为"。

const NOTEBOOK_RE = /^[a-zA-Z0-9_\-\u4e00-\u9fa5]{1,64}$/;
const DEFAULT_NOTEBOOKS = ['notebook1', 'notebook2', 'notebook3'];
const MAX_NOTE_BYTES = 5 * 1024 * 1024;

const json = (payload, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
const ok = (extra = {}) => json({ status: 'success', ...extra });
const err = (message, status = 400, extra = {}) => json({ status: 'error', message, ...extra }, status);

const noteKey = (name) => `note:${name}`;
const histPrefix = (name) => `hist:${name}:`;
const validName = (n) => typeof n === 'string' && NOTEBOOK_RE.test(n);

function corsHeaders(env, request) {
  const allowed = env.ALLOWED_ORIGIN;
  if (!allowed) return {};
  const origin = request.headers.get('Origin') || '';
  const list = allowed.split(',').map((s) => s.trim());
  if (!(list.includes('*') || list.includes(origin))) return {};
  return {
    'Access-Control-Allow-Origin': list.includes('*') ? '*' : origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function authorized(env, request) {
  if (!env.NOTEPAD_TOKEN) return true;
  const header = request.headers.get('Authorization') || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  return timingSafeEqual(supplied, env.NOTEPAD_TOKEN);
}

async function readNote(env, name) {
  const { value, metadata } = await env.NOTES_KV.getWithMetadata(noteKey(name));
  if (value !== null) {
    return { content: value, version: metadata?.version ?? null, exists: true };
  }
  // 旧格式迁移
  const legacy = await env.NOTES_KV.get(name);
  if (legacy !== null) {
    const version = await writeNote(env, name, legacy);
    await env.NOTES_KV.delete(name);
    return { content: legacy, version, exists: true };
  }
  return { content: '', version: null, exists: false };
}

async function writeNote(env, name, content) {
  const version = String(Date.now());
  await env.NOTES_KV.put(noteKey(name), content, {
    metadata: { version, size: content.length, updated: new Date().toISOString() },
  });
  return version;
}

async function snapshot(env, name, content) {
  if (!content) return;
  const keep = Number(env.HISTORY_KEEP || 20);
  const ts = new Date().toISOString().replace(/[-:T]/g, '').replace(/\..*$/, '').replace(/^(\d{8})/, '$1-');
  await env.NOTES_KV.put(`${histPrefix(name)}${ts}-${Date.now() % 1000000}`, content);
  const list = await env.NOTES_KV.list({ prefix: histPrefix(name) });
  const names = list.keys.map((k) => k.name).sort();
  const excess = names.slice(0, Math.max(0, names.length - keep));
  await Promise.all(excess.map((k) => env.NOTES_KV.delete(k)));
}

async function listNotebooks(env) {
  const list = await env.NOTES_KV.list({ prefix: 'note:' });
  let items = list.keys.map((k) => ({
    name: k.name.slice(5),
    version: k.metadata?.version ?? null,
    size: k.metadata?.size ?? 0,
  }));
  if (!items.length) {
    // 尝试迁移旧的裸 key，否则创建默认笔记本
    for (const n of DEFAULT_NOTEBOOKS) {
      const legacy = await env.NOTES_KV.get(n);
      const version = await writeNote(env, n, legacy ?? '');
      if (legacy !== null) await env.NOTES_KV.delete(n);
      items.push({ name: n, version, size: (legacy ?? '').length });
    }
  }
  items.sort((a, b) => {
    const pa = a.name.startsWith('notebook') ? [a.name.length, a.name] : [999, a.name];
    const pb = b.name.startsWith('notebook') ? [b.name.length, b.name] : [999, b.name];
    return pa[0] - pb[0] || (pa[1] < pb[1] ? -1 : pa[1] > pb[1] ? 1 : 0);
  });
  return items;
}

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const segs = path.split('/').filter(Boolean).map(decodeURIComponent);

  const readBody = async () => {
    try {
      return await request.json();
    } catch {
      return null;
    }
  };

  // GET /notebooks
  if (path === '/notebooks' && method === 'GET') {
    return ok({ notebooks: await listNotebooks(env) });
  }

  // POST /notebooks
  if (path === '/notebooks' && method === 'POST') {
    const body = await readBody();
    const name = body?.name;
    if (!validName(name)) return err('非法的笔记本名称');
    if ((await env.NOTES_KV.get(noteKey(name))) !== null) return err('笔记本已存在', 409);
    const version = await writeNote(env, name, '');
    return ok({ name, version });
  }

  // PATCH / DELETE /notebooks/<name>
  if (segs[0] === 'notebooks' && segs.length === 2) {
    const name = segs[1];
    if (!validName(name)) return err('非法的笔记本名称');
    if (method === 'PATCH') {
      const body = await readBody();
      const newName = body?.name;
      if (!validName(newName)) return err('非法的笔记本名称');
      const cur = await readNote(env, name);
      if (!cur.exists) return err('笔记本不存在', 404);
      if ((await env.NOTES_KV.get(noteKey(newName))) !== null) return err('目标名称已存在', 409);
      const version = await writeNote(env, newName, cur.content);
      await env.NOTES_KV.delete(noteKey(name));
      // 迁移历史
      const hist = await env.NOTES_KV.list({ prefix: histPrefix(name) });
      for (const k of hist.keys) {
        const v = await env.NOTES_KV.get(k.name);
        if (v !== null) await env.NOTES_KV.put(k.name.replace(histPrefix(name), histPrefix(newName)), v);
        await env.NOTES_KV.delete(k.name);
      }
      return ok({ name: newName, version });
    }
    if (method === 'DELETE') {
      const cur = await readNote(env, name);
      if (!cur.exists) return err('笔记本不存在', 404);
      if ((await listNotebooks(env)).length <= 1) return err('至少保留一个笔记本');
      await snapshot(env, name, cur.content);
      await env.NOTES_KV.delete(noteKey(name));
      return ok();
    }
  }

  // GET /load/<name>
  if (segs[0] === 'load' && segs.length === 2 && method === 'GET') {
    const name = segs[1];
    if (!validName(name)) return err('非法的笔记本名称');
    const { content, version } = await readNote(env, name);
    return ok({ content, version });
  }

  // POST /save
  if (path === '/save' && method === 'POST') {
    const body = await readBody();
    if (!body) return err('请求体必须是 JSON');
    const { notebook = 'notebook1', content = '', version: clientVersion = null, force = false } = body;
    if (!validName(notebook)) return err('非法的笔记本名称');
    if (typeof content !== 'string') return err('content 必须是字符串');
    if (content.length > MAX_NOTE_BYTES) return err('内容过大', 413);

    const cur = await readNote(env, notebook);
    if (!force && clientVersion !== null && cur.exists && String(clientVersion) !== cur.version) {
      return err('笔记本已在别处被修改', 409, { version: cur.version, content: cur.content });
    }
    if (cur.exists && cur.content === content) return ok({ version: cur.version, unchanged: true });

    await snapshot(env, notebook, cur.content);
    const version = await writeNote(env, notebook, content);
    return ok({ version });
  }

  // GET /history/<name>  /history/<name>/<id>
  if (segs[0] === 'history' && (segs.length === 2 || segs.length === 3) && method === 'GET') {
    const name = segs[1];
    if (!validName(name)) return err('非法的笔记本名称');
    if (segs.length === 2) {
      const list = await env.NOTES_KV.list({ prefix: histPrefix(name) });
      const history = list.keys
        .map((k) => ({ id: k.name.slice(histPrefix(name).length), size: 0 }))
        .sort((a, b) => (a.id < b.id ? 1 : -1));
      return ok({ history });
    }
    const id = segs[2];
    if (!/^[0-9\-]{1,32}$/.test(id)) return err('非法参数');
    const content = await env.NOTES_KV.get(`${histPrefix(name)}${id}`);
    if (content === null) return err('历史版本不存在', 404);
    return ok({ content });
  }

  return err('Not Found', 404);
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env, request);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    let resp;
    if (!authorized(env, request)) {
      resp = err('未授权', 401);
    } else {
      try {
        resp = await handle(request, env);
      } catch (e) {
        resp = err(e.message || String(e), 500);
      }
    }
    for (const [k, v] of Object.entries(cors)) resp.headers.set(k, v);
    return resp;
  },
};
