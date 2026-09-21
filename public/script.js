// 同源部署留空；前后端分离部署时填后端地址
const API_BASE_URL = '';

const AUTOSAVE_DELAY = 800;
const DRAFT_DELAY = 300; // 本地草稿写入合并间隔
const SAVE_RETRY_DELAY = 5000; // 保存因网络失败后的重试间隔
const SAVE_MAX_RETRIES = 3; // 连续失败超过这个次数就等网络恢复，不再定时重试
const KEEPALIVE_LIMIT = 60 * 1024; // fetch keepalive 的请求体上限约 64KB
const RESYNC_MIN_INTERVAL = 2000; // 切回页面触发重新同步的最小间隔
const TOKEN_KEY = 'notepad_token';
const LAST_TAB_KEY = 'notepad_last_tab';
const LEGACY_TABS = { notebook1: '翠', notebook2: '梅贝儿', notebook3: '爱利希雅' };
// 是否在界面上显示 新建 / 重命名 / 删除 笔记本的入口。后端接口一直保留，改成 true 即可恢复。
const ENABLE_NOTEBOOK_MANAGE = false;
const draftKey = (nb) => `notepad_draft:${nb}`;

const $ = (id) => document.getElementById(id);
const notepad = $('notepad');
const statusEl = $('status');
const statsEl = $('stats');
const tabsEl = $('tabs');
const tabAddBtn = $('tab-add');
const themeToggle = $('theme-toggle');
const html = document.documentElement;

// ---------- 状态 ----------
let notebooks = [];
let currentNotebook = null;
let currentVersion = null;
let dirty = false;
let saving = false;
let saveQueued = false;
let saveTimer = null;
let saveRetries = 0;
let loadAbort = null;
let conflictRemote = null;

// ---------- 工具 ----------
function setStatus(text, kind = '') {
    statusEl.textContent = text;
    statusEl.dataset.kind = kind;
}

function updateStats() {
    const text = notepad.value;
    const chars = [...text.replace(/\s/g, '')].length;
    const lines = text ? text.split('\n').length : 0;
    statsEl.textContent = `${chars} 字 · ${lines} 行`;
}

function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
}

async function api(path, options = {}, retry = true) {
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined && !(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(API_BASE_URL + path, { ...options, headers });
    if (res.status === 401 && retry) {
        const input = prompt('需要访问令牌（NOTEPAD_TOKEN）：');
        if (input === null) throw new Error('未授权');
        localStorage.setItem(TOKEN_KEY, input.trim());
        return api(path, options, false);
    }
    let data = {};
    try { data = await res.json(); } catch { /* 非 JSON */ }
    return { res, data };
}

// ---------- 主题 ----------
function applyTheme(theme) {
    html.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    // 手机浏览器地址栏 / PWA 状态栏颜色跟随主题
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
        m.setAttribute('content', theme === 'dark' ? '#1a1a1a' : '#ffffff');
    });
}
applyTheme(localStorage.getItem('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
themeToggle.addEventListener('click', () => {
    applyTheme(html.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
});

// ---------- 复制全部 ----------
$('copy-all').addEventListener('click', async () => {
    const text = notepad.value;
    if (!text) { setStatus('没有内容可复制'); return; }
    try {
        await navigator.clipboard.writeText(text);
        setStatus('已复制全部内容');
    } catch {
        // 不支持 clipboard API（如非 HTTPS）时退回选中 + execCommand
        notepad.focus();
        notepad.select();
        const okCopy = document.execCommand && document.execCommand('copy');
        notepad.setSelectionRange(notepad.value.length, notepad.value.length);
        setStatus(okCopy ? '已复制全部内容' : '复制失败，请手动选择', okCopy ? '' : 'error');
    }
});

// ---------- 草稿 ----------
let draftTimer = null;

function writeDraft() {
    draftTimer = null;
    if (!currentNotebook || !dirty) return;
    try {
        localStorage.setItem(draftKey(currentNotebook), JSON.stringify({
            content: notepad.value,
            version: currentVersion,
            ts: Date.now(),
        }));
    } catch { /* 容量满了就算了 */ }
}

// 每次按键都同步写整篇到 localStorage 会卡，这里合并 300ms
function saveDraft() {
    if (draftTimer) return;
    draftTimer = setTimeout(writeDraft, DRAFT_DELAY);
}

function flushDraft() {
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
    writeDraft();
}

function clearDraft(nb = currentNotebook) {
    if (nb === currentNotebook && draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
    if (nb) localStorage.removeItem(draftKey(nb));
}

function checkDraft(nb, serverContent) {
    const raw = localStorage.getItem(draftKey(nb));
    if (!raw) return;
    let draft;
    try { draft = JSON.parse(raw); } catch { clearDraft(nb); return; }
    if (!draft || draft.content === serverContent) { clearDraft(nb); return; }
    const banner = $('draft-banner');
    banner.hidden = false;
    $('draft-restore').onclick = () => {
        banner.hidden = true;
        notepad.value = draft.content;
        markDirty();
        scheduleSave(0);
    };
    $('draft-discard').onclick = () => {
        banner.hidden = true;
        clearDraft(nb);
    };
}

// ---------- 加载 / 保存 ----------
// 同步优先：没从服务端拿到最新内容之前，禁止编辑
function lockEditor(reason) {
    notepad.readOnly = true;
    notepad.placeholder = reason || '正在同步…';
}

function unlockEditor() {
    notepad.readOnly = false;
    notepad.placeholder = '在这里输入内容…（Ctrl+S 立即保存，Tab 缩进）';
    $('load-banner').hidden = true;
}

function showLoadFailure(message) {
    lockEditor('同步失败，已禁止编辑');
    $('load-banner-text').textContent = `同步失败：${message}。为避免覆盖其他设备上的内容，已禁止编辑。`;
    $('load-banner').hidden = false;
    setStatus('同步失败', 'error');
}

// 把服务端返回的内容应用到编辑器并解锁
function applyLoaded(nb, data) {
    notepad.value = data.content;
    currentVersion = data.version;
    dirty = false;
    unlockEditor();
    setStatus('已同步');
    updateStats();
    if (matchMedia('(pointer: fine)').matches) notepad.focus();
    checkDraft(nb, data.content);
}

function beginLoading() {
    if (loadAbort) loadAbort.abort();
    loadAbort = new AbortController();
    $('conflict-banner').hidden = true;
    $('draft-banner').hidden = true;
    $('load-banner').hidden = true;
    lockEditor('正在同步…');
    notepad.value = '';
    dirty = false;
    setStatus('正在同步…');
    return loadAbort.signal;
}

async function loadNotebook(nb) {
    const signal = beginLoading();
    try {
        const { res, data } = await api(`/load/${encodeURIComponent(nb)}`, { signal });
        if (nb !== currentNotebook) return;
        if (!res.ok || data.status !== 'success') {
            showLoadFailure(data.message || `HTTP ${res.status}`);
            return;
        }
        applyLoaded(nb, data);
    } catch (e) {
        if (e.name === 'AbortError') return;
        if (nb !== currentNotebook) return;
        showLoadFailure(e.message || '网络错误');
    }
}

$('load-retry').addEventListener('click', () => {
    if (currentNotebook) loadNotebook(currentNotebook);
});

// 切回页面时静默重新同步：本地没有未保存修改才做，避免覆盖正在输入的内容
let lastResyncAt = 0;
let resyncing = false;

async function resyncIfIdle() {
    if (!currentNotebook || dirty || saving || saveTimer || resyncing) return;
    if (Date.now() - lastResyncAt < RESYNC_MIN_INTERVAL) return;
    if (!$('load-banner').hidden) { loadNotebook(currentNotebook); return; } // 之前失败过，直接重试
    if (notepad.readOnly) return; // 正在首次加载
    lastResyncAt = Date.now();
    resyncing = true;
    const nb = currentNotebook;
    try {
        const { res, data } = await api(
            `/load/${encodeURIComponent(nb)}?if_version=${encodeURIComponent(currentVersion ?? '')}`,
        );
        if (nb !== currentNotebook || dirty || saving) return; // 期间用户动了
        if (!res.ok || data.status !== 'success') return;      // 静默失败，不打扰
        if (!data.unchanged && data.version !== currentVersion) {
            const pos = notepad.selectionStart;
            notepad.value = data.content;
            currentVersion = data.version;
            notepad.setSelectionRange(Math.min(pos, notepad.value.length), Math.min(pos, notepad.value.length));
            updateStats();
            setStatus('已同步最新内容 - ' + new Date().toLocaleTimeString());
        }
    } catch { /* 静默 */ } finally {
        resyncing = false;
    }
}

// 回到前台 / 网络恢复：有没存上的内容就先补存，否则拉一次最新
function onPageActive() {
    if (dirty && !saving) { saveRetries = 0; flushSave(); } else resyncIfIdle();
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onPageActive();
});
window.addEventListener('focus', onPageActive);
window.addEventListener('online', onPageActive);

function markDirty() {
    dirty = true;
    setStatus('未保存…', 'dirty');
    saveDraft();
    updateStats();
}

function scheduleSave(delay = AUTOSAVE_DELAY) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; autoSave(); }, delay);
}

async function autoSave(force = false) {
    if (!dirty || !currentNotebook) return;
    if (saving) { saveQueued = true; return; }
    saving = true;
    const nb = currentNotebook;
    const content = notepad.value;
    const version = currentVersion;
    setStatus('保存中…');
    try {
        const { res, data } = await api('/save', {
            method: 'POST',
            body: JSON.stringify({ notebook: nb, content, version, force }),
        });
        if (nb !== currentNotebook) return; // 期间切换了笔记本
        if (res.status === 409) {
            conflictRemote = data;
            $('conflict-banner').hidden = false;
            setStatus('保存被拒绝：远端有新版本', 'error');
            return;
        }
        if (!res.ok || data.status !== 'success') {
            setStatus('保存失败：' + (data.message || res.status), 'error');
            return;
        }
        currentVersion = data.version;
        $('conflict-banner').hidden = true;
        saveRetries = 0;
        if (notepad.value === content) {
            dirty = false;
            clearDraft(nb);
            setStatus('已保存 - ' + new Date().toLocaleTimeString());
        } else {
            saveQueued = true; // 保存期间又改了
        }
    } catch (e) {
        if (nb !== currentNotebook) return;
        // 网络问题：自动重试几次，用完次数就等 online 事件，不无限重试打扰后台
        saveRetries += 1;
        if (saveRetries <= SAVE_MAX_RETRIES) {
            setStatus(`保存失败，${SAVE_RETRY_DELAY / 1000} 秒后重试（已存本地草稿）`, 'error');
            saveQueued = true;
        } else {
            setStatus('保存失败：' + e.message + '（已存本地草稿，网络恢复后自动重试）', 'error');
        }
    } finally {
        saving = false;
        if (saveQueued) {
            saveQueued = false;
            scheduleSave(saveRetries ? SAVE_RETRY_DELAY : 300);
        }
    }
}

function flushSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    return autoSave();
}

$('conflict-reload').addEventListener('click', () => {
    if (!conflictRemote) return;
    notepad.value = conflictRemote.content ?? '';
    currentVersion = conflictRemote.version;
    dirty = false;
    clearDraft();
    conflictRemote = null;
    $('conflict-banner').hidden = true;
    setStatus('已加载远端版本');
    updateStats();
});

$('conflict-overwrite').addEventListener('click', () => {
    $('conflict-banner').hidden = true;
    conflictRemote = null;
    dirty = true;
    autoSave(true);
});

// 关闭页面 / 切后台时兜底保存。
// 手机上按 Home 后定时器会被冻结、pagehide 不一定触发，visibilitychange(hidden) 最可靠。
function beaconSave() {
    if (!dirty || !currentNotebook || saving) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    flushDraft();
    const nb = currentNotebook;
    const content = notepad.value;
    const body = JSON.stringify({ notebook: nb, content, version: currentVersion });
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    saving = true; // 复用 saving 标志，避免回到前台后 autoSave 并发写、版本错乱
    fetch(API_BASE_URL + '/save', {
        method: 'POST',
        headers,
        body,
        keepalive: body.length <= KEEPALIVE_LIMIT, // 超过上限 keepalive 会直接被拒，退回普通请求
    })
        .then((res) => res.json())
        .then((data) => {
            // 页面还活着（只是切了后台）时把结果记下来，回来后不用重复保存
            if (data.status !== 'success' || nb !== currentNotebook) return;
            currentVersion = data.version;
            if (notepad.value === content) {
                dirty = false;
                clearDraft(nb);
                setStatus('已保存 - ' + new Date().toLocaleTimeString());
            }
        })
        .catch(() => {})
        .finally(() => {
            saving = false;
            if (saveQueued || (dirty && nb === currentNotebook)) {
                saveQueued = false;
                scheduleSave(300);
            }
        });
}

window.addEventListener('pagehide', beaconSave);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') beaconSave();
});

window.addEventListener('beforeunload', (e) => {
    if (dirty && saving) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- 编辑器输入 ----------
notepad.addEventListener('input', () => {
    markDirty();
    scheduleSave();
});

notepad.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !notepad.readOnly) {
        e.preventDefault();
        indentSelection(e.shiftKey);
        notepad.dispatchEvent(new Event('input'));
    }
});

function indentSelection(outdent) {
    const INDENT = '    ';
    const { selectionStart: start, selectionEnd: end, value } = notepad;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEndIdx = value.indexOf('\n', end);
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
    const multiLine = value.slice(start, end).includes('\n');

    if (!multiLine && !outdent) {
        notepad.setRangeText(INDENT, start, end, 'end');
        return;
    }
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    let removedFirst = 0;
    const out = lines.map((ln, i) => {
        if (outdent) {
            const m = ln.match(/^( {1,4}|\t)/);
            const cut = m ? m[0].length : 0;
            if (i === 0) removedFirst = cut;
            return ln.slice(cut);
        }
        return INDENT + ln;
    }).join('\n');
    notepad.setRangeText(out, lineStart, lineEnd, 'preserve');
    const delta = out.length - block.length;
    const newStart = outdent ? Math.max(lineStart, start - removedFirst) : start + INDENT.length;
    notepad.setSelectionRange(newStart, end + delta);
}

document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        flushSave();
    }
    if (e.key === 'Escape') {
        $('history-panel').hidden = true;
    }
});

// ---------- 笔记本标签 ----------
function renderTabs() {
    tabsEl.querySelectorAll('.tab-btn:not(.tab-add)').forEach((el) => el.remove());
    notebooks.forEach((nb) => {
        const btn = document.createElement('button');
        btn.className = 'tab-btn' + (nb.name === currentNotebook ? ' active' : '');
        btn.dataset.notebook = nb.name;
        if (ENABLE_NOTEBOOK_MANAGE) btn.title = '双击重命名';
        const label = document.createElement('span');
        label.textContent = nb.name;
        btn.appendChild(label);
        if (ENABLE_NOTEBOOK_MANAGE && nb.name === currentNotebook && notebooks.length > 1) {
            const close = document.createElement('span');
            close.className = 'tab-close';
            close.textContent = '×';
            close.title = '删除笔记本';
            close.addEventListener('click', (e) => { e.stopPropagation(); deleteNotebook(nb.name); });
            btn.appendChild(close);
        }
        btn.addEventListener('click', () => switchNotebook(nb.name));
        if (ENABLE_NOTEBOOK_MANAGE) {
            btn.addEventListener('dblclick', (e) => { e.preventDefault(); renameNotebook(nb.name); });
        }
        tabsEl.insertBefore(btn, tabAddBtn);
    });
}

async function switchNotebook(name) {
    if (name === currentNotebook) return;
    await flushSave();
    currentNotebook = name;
    localStorage.setItem(LAST_TAB_KEY, name);
    history.replaceState(null, '', `#${encodeURIComponent(name)}`);
    renderTabs();
    await loadNotebook(name);
}

async function refreshNotebooks() {
    const { res, data } = await api('/notebooks');
    if (!res.ok || data.status !== 'success') throw new Error(data.message || res.status);
    notebooks = data.notebooks;
    renderTabs();
}

async function createNotebook() {
    const name = prompt('新笔记本名称（字母、数字、中文、- _）：');
    if (!name) return;
    const { res, data } = await api('/notebooks', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
    if (!res.ok) { alert(data.message || '创建失败'); return; }
    await refreshNotebooks();
    switchNotebook(data.name);
}

async function renameNotebook(oldName) {
    const name = prompt('重命名为：', oldName);
    if (!name || name.trim() === oldName) return;
    await flushSave();
    const { res, data } = await api(`/notebooks/${encodeURIComponent(oldName)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim() }),
    });
    if (!res.ok) { alert(data.message || '重命名失败'); return; }
    const draft = localStorage.getItem(draftKey(oldName));
    if (draft) { localStorage.setItem(draftKey(data.name), draft); clearDraft(oldName); }
    if (currentNotebook === oldName) {
        currentNotebook = data.name;
        currentVersion = data.version;
        localStorage.setItem(LAST_TAB_KEY, data.name);
        history.replaceState(null, '', `#${encodeURIComponent(data.name)}`);
    }
    await refreshNotebooks();
}

async function deleteNotebook(name) {
    if (!confirm(`确定删除「${name}」？内容和全部历史都会被删除，无法恢复。`)) return;
    const { res, data } = await api(`/notebooks/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!res.ok) { alert(data.message || '删除失败'); return; }
    clearDraft(name);
    await refreshNotebooks();
    if (currentNotebook === name) {
        currentNotebook = null;
        dirty = false;
        await switchNotebook(notebooks[0].name);
    }
}

tabAddBtn.hidden = !ENABLE_NOTEBOOK_MANAGE;
tabAddBtn.addEventListener('click', createNotebook);

// ---------- 历史版本 ----------
const historyPanel = $('history-panel');
const historyList = $('history-list');
let historySelected = null;
let historySelectedId = null;

function formatHistoryId(id) {
    const m = id.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : id;
}

function relativeTime(tsSec) {
    const diff = Math.max(0, Date.now() / 1000 - tsSec);
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
    return new Date(tsSec * 1000).toLocaleDateString();
}

async function loadHistoryPanel() {
    const { res, data } = await api(`/history/${encodeURIComponent(currentNotebook)}`);
    historyList.innerHTML = '';
    $('history-preview').hidden = true;
    historySelected = null;
    historySelectedId = null;
    if (!res.ok) return;
    if (!data.history.length) {
        historyList.innerHTML = '<li class="muted">还没有历史版本</li>';
        return;
    }
    data.history.forEach((h) => {
        const li = document.createElement('li');
        const label = document.createElement('span');
        label.className = 'hist-label';
        label.textContent = `${relativeTime(h.ts)} · ${h.chars} 字`;
        label.title = formatHistoryId(h.id);
        const del = document.createElement('button');
        del.className = 'hist-del';
        del.type = 'button';
        del.title = '删除此条';
        del.textContent = '×';
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteHistoryItem(h.id);
        });
        li.append(label, del);
        li.addEventListener('click', async () => {
            historyList.querySelectorAll('li').forEach((el) => el.classList.remove('active'));
            li.classList.add('active');
            const r = await api(`/history/${encodeURIComponent(currentNotebook)}/${h.id}`);
            if (!r.res.ok) return;
            historySelected = r.data.content;
            historySelectedId = h.id;
            $('history-content').textContent = historySelected;
            $('history-preview').hidden = false;
        });
        historyList.appendChild(li);
    });
}

async function deleteHistoryItem(id) {
    if (!confirm('确定删除这条历史？删除后无法恢复。')) return;
    const { res, data } = await api(`/history/${encodeURIComponent(currentNotebook)}/${id}`, { method: 'DELETE' });
    if (!res.ok) { alert(data.message || '删除失败'); return; }
    setStatus('已删除一条历史');
    await loadHistoryPanel();
}

$('history-toggle').addEventListener('click', async () => {
    if (!historyPanel.hidden) { historyPanel.hidden = true; return; }
    await flushSave();
    await loadHistoryPanel();
    historyPanel.hidden = false;
});
$('history-close').addEventListener('click', () => { historyPanel.hidden = true; });
$('history-clear').addEventListener('click', async () => {
    if (!confirm('清空当前笔记本的全部历史？删除后无法恢复。')) return;
    const { res, data } = await api(`/history/${encodeURIComponent(currentNotebook)}`, { method: 'DELETE' });
    if (!res.ok) { alert(data.message || '清空失败'); return; }
    setStatus('已清空历史');
    await loadHistoryPanel();
});
$('history-delete').addEventListener('click', () => {
    if (!historySelectedId) return;
    deleteHistoryItem(historySelectedId);
});
$('history-restore').addEventListener('click', () => {
    if (historySelected === null) return;
    if (!confirm('用此历史版本覆盖当前内容？（当前内容会先存入历史）')) return;
    notepad.value = historySelected;
    historyPanel.hidden = true;
    markDirty();
    flushSave();
});

// ---------- 启动 ----------
async function init() {
    // 旧名称的本地草稿跟着改名迁移
    for (const [oldName, newName] of Object.entries(LEGACY_TABS)) {
        const d = localStorage.getItem(draftKey(oldName));
        if (d && !localStorage.getItem(draftKey(newName))) localStorage.setItem(draftKey(newName), d);
        if (d) localStorage.removeItem(draftKey(oldName));
    }
    const fromHash = LEGACY_TABS[decodeURIComponent(location.hash.slice(1))] || decodeURIComponent(location.hash.slice(1));
    const rememberedRaw = localStorage.getItem(LAST_TAB_KEY);
    const want = fromHash || LEGACY_TABS[rememberedRaw] || rememberedRaw || '';

    // 一次请求拿到列表 + 内容
    const signal = beginLoading();
    $('load-retry').onclick = () => { $('load-banner').hidden = true; init(); };
    try {
        const { res, data } = await api(`/bootstrap?notebook=${encodeURIComponent(want)}`, { signal });
        if (!res.ok || data.status !== 'success') {
            showLoadFailure(data.message || `HTTP ${res.status}`);
            return;
        }
        notebooks = data.notebooks;
        currentNotebook = data.notebook;
        localStorage.setItem(LAST_TAB_KEY, currentNotebook);
        history.replaceState(null, '', `#${encodeURIComponent(currentNotebook)}`);
        renderTabs();
        applyLoaded(currentNotebook, data);
        $('load-retry').onclick = null; // 之后的重试走 loadNotebook
    } catch (e) {
        if (e.name === 'AbortError') return;
        showLoadFailure(e.message || '网络错误');
    }
}

init();
