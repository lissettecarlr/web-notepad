import hashlib
import hmac
import os
import re
import shutil
import tempfile
import threading
import time

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.middleware.proxy_fix import ProxyFix

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, 'public')
NOTES_DIR = os.environ.get('NOTES_DIR', os.path.join(BASE_DIR, 'notes'))
HISTORY_DIR = os.path.join(NOTES_DIR, '.history')
HISTORY_KEEP = int(os.environ.get('HISTORY_KEEP', '20'))
TOKEN = os.environ.get('NOTEPAD_TOKEN', '')
DEFAULT_NOTEBOOKS = ['翠', '梅贝儿', '爱利希雅']
LEGACY_RENAME = {
    'notebook1': '翠',
    'notebook2': '梅贝儿',
    'notebook3': '爱利希雅',
}

NOTEBOOK_RE = re.compile(r'^[a-zA-Z0-9_\-\u4e00-\u9fa5]{1,64}$')

os.makedirs(HISTORY_DIR, exist_ok=True)

app = Flask(__name__, static_folder=PUBLIC_DIR, static_url_path='')
app.config['MAX_CONTENT_LENGTH'] = int(os.environ.get('MAX_NOTE_BYTES', str(5 * 1024 * 1024)))

# 放在 nginx / Caddy / Cloudflare 等反向代理后面时设 BEHIND_PROXY=1，
# 让限速用 X-Forwarded-For 里的真实客户端 IP，而不是代理 IP。
# 直接暴露公网时不要开，否则客户端可伪造头绕过限速。
if os.environ.get('BEHIND_PROXY', '0') == '1':
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)


# ---------- helpers ----------

def err(message, code=400, **extra):
    payload = {'status': 'error', 'message': message}
    payload.update(extra)
    return jsonify(payload), code


def ok(**extra):
    payload = {'status': 'success'}
    payload.update(extra)
    return jsonify(payload)


def note_path(notebook):
    return os.path.join(NOTES_DIR, f'{notebook}.txt')


def note_version(path):
    try:
        return str(os.stat(path).st_mtime_ns)
    except FileNotFoundError:
        return None


def read_note(path):
    try:
        with open(path, 'r', encoding='utf-8-sig', newline='') as f:
            return f.read()
    except FileNotFoundError:
        return ''


def atomic_write(path, text):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def snapshot(notebook):
    """保存前把旧内容存进历史目录，并裁剪到 HISTORY_KEEP 份。"""
    src = note_path(notebook)
    if not os.path.exists(src) or os.path.getsize(src) == 0:
        return
    hist = os.path.join(HISTORY_DIR, notebook)
    os.makedirs(hist, exist_ok=True)
    now = time.time()
    # 固定宽度：YYYYmmdd-HHMMSS-微秒，保证按文件名排序即按时间排序
    ts = time.strftime('%Y%m%d-%H%M%S', time.localtime(now)) + f'-{int((now % 1) * 1_000_000):06d}'
    dst = os.path.join(hist, f'{ts}.txt')
    shutil.copy2(src, dst)
    files = sorted(os.listdir(hist))
    for old in files[:-HISTORY_KEEP] if len(files) > HISTORY_KEEP else []:
        os.unlink(os.path.join(hist, old))


def migrate_legacy_notebooks():
    for old, new in LEGACY_RENAME.items():
        src, dst = note_path(old), note_path(new)
        if not os.path.exists(src) or os.path.exists(dst):
            continue
        os.replace(src, dst)
        old_hist = os.path.join(HISTORY_DIR, old)
        new_hist = os.path.join(HISTORY_DIR, new)
        if os.path.isdir(old_hist):
            if os.path.isdir(new_hist):
                for fn in os.listdir(old_hist):
                    os.replace(os.path.join(old_hist, fn), os.path.join(new_hist, fn))
                os.rmdir(old_hist)
            else:
                os.replace(old_hist, new_hist)


def list_notebooks():
    migrate_legacy_notebooks()
    names = []
    for fn in os.listdir(NOTES_DIR):
        if fn.endswith('.txt') and NOTEBOOK_RE.match(fn[:-4]):
            names.append(fn[:-4])
    if not names:
        for n in DEFAULT_NOTEBOOKS:
            atomic_write(note_path(n), '')
        names = list(DEFAULT_NOTEBOOKS)
    order = {n: i for i, n in enumerate(DEFAULT_NOTEBOOKS)}
    names.sort(key=lambda s: (order.get(s, 999), s))
    result = []
    for n in names:
        p = note_path(n)
        st = os.stat(p)
        result.append({'name': n, 'version': str(st.st_mtime_ns), 'size': st.st_size})
    return result


def valid_name(name):
    return isinstance(name, str) and NOTEBOOK_RE.match(name) is not None


# ---------- auth ----------

# 令牌错误限速：同一 IP 连续失败 AUTH_MAX_FAILS 次后锁定 AUTH_LOCK_SECONDS 秒。
# 进程内存级实现，gunicorn 多 worker 时按 worker 独立计数（效果打折，但足够拦住慢速穷举）。
AUTH_MAX_FAILS = int(os.environ.get('AUTH_MAX_FAILS', '5'))
AUTH_LOCK_SECONDS = int(os.environ.get('AUTH_LOCK_SECONDS', '60'))
_auth_fails = {}  # ip -> [fail_count, locked_until_ts]
_auth_lock = threading.Lock()


def client_ip():
    return request.remote_addr or 'unknown'


def auth_locked(ip):
    with _auth_lock:
        rec = _auth_fails.get(ip)
        if not rec:
            return 0
        remaining = rec[1] - time.time()
        if remaining > 0:
            return int(remaining) + 1
        if rec[1]:
            _auth_fails.pop(ip, None)  # 锁过期，清零
        return 0


def auth_record_failure(ip):
    with _auth_lock:
        rec = _auth_fails.setdefault(ip, [0, 0])
        rec[0] += 1
        if rec[0] >= AUTH_MAX_FAILS:
            rec[1] = time.time() + AUTH_LOCK_SECONDS
            rec[0] = 0
        # 防止字典无限增长
        if len(_auth_fails) > 10000:
            now = time.time()
            for k in [k for k, v in _auth_fails.items() if v[1] and v[1] < now]:
                _auth_fails.pop(k, None)


def auth_record_success(ip):
    with _auth_lock:
        _auth_fails.pop(ip, None)


@app.before_request
def check_auth():
    if not TOKEN:
        return None
    if request.method == 'OPTIONS':
        return None
    # 静态资源与首页放行
    if request.endpoint in ('index', 'static'):
        return None
    ip = client_ip()
    wait = auth_locked(ip)
    if wait:
        resp, _ = err(f'尝试次数过多，请 {wait} 秒后再试', 429)
        resp.headers['Retry-After'] = str(wait)
        return resp, 429
    header = request.headers.get('Authorization', '')
    supplied = header[7:] if header.startswith('Bearer ') else ''
    if not hmac.compare_digest(supplied, TOKEN):
        auth_record_failure(ip)
        return err('未授权', 401)
    auth_record_success(ip)
    return None


@app.after_request
def cache_headers(resp):
    p = request.path
    if p.startswith(('/load/', '/notebooks', '/history/', '/bootstrap')):
        resp.headers['Cache-Control'] = 'no-store'
    elif p == '/' or p == '/index.html':
        # 首页每次都回源校验，保证拿到带新哈希的资源地址
        resp.headers['Cache-Control'] = 'no-cache'
    elif p in ('/script.js', '/style.css') and request.args.get('v'):
        # 地址里带内容哈希，可以放心长期缓存；内容一变地址就变
        resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return resp


@app.errorhandler(413)
def too_large(_):
    return err('内容过大', 413)


# ---------- routes ----------

def asset_hash(name):
    with open(os.path.join(PUBLIC_DIR, name), 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()[:10]


# 启动时把 index.html 里的 /script.js、/style.css 换成带内容哈希的地址，
# 避免浏览器拿新 HTML 配旧脚本（曾导致编辑框一直只读）。
with open(os.path.join(PUBLIC_DIR, 'index.html'), encoding='utf-8') as _f:
    INDEX_HTML = _f.read()
for _asset in ('script.js', 'style.css'):
    INDEX_HTML = INDEX_HTML.replace(f'"/{_asset}"', f'"/{_asset}?v={asset_hash(_asset)}"')


@app.route('/')
def index():
    resp = app.response_class(INDEX_HTML, mimetype='text/html')
    return resp


@app.route('/notebooks', methods=['GET'])
def notebooks():
    return ok(notebooks=list_notebooks())


@app.route('/bootstrap', methods=['GET'])
def bootstrap():
    """一次请求返回笔记本列表 + 目标笔记本内容，减少首屏往返。"""
    nbs = list_notebooks()
    want = request.args.get('notebook', '')
    names = [n['name'] for n in nbs]
    chosen = want if want in names else names[0]
    p = note_path(chosen)
    return ok(notebooks=nbs, notebook=chosen, content=read_note(p), version=note_version(p))


@app.route('/notebooks', methods=['POST'])
def create_notebook():
    data = request.get_json(silent=True) or {}
    name = data.get('name', '')
    if not valid_name(name):
        return err('非法的笔记本名称')
    p = note_path(name)
    if os.path.exists(p):
        return err('笔记本已存在', 409)
    atomic_write(p, '')
    return ok(name=name, version=note_version(p))


@app.route('/notebooks/<notebook>', methods=['PATCH'])
def rename_notebook(notebook):
    data = request.get_json(silent=True) or {}
    new = data.get('name', '')
    if not valid_name(notebook) or not valid_name(new):
        return err('非法的笔记本名称')
    src, dst = note_path(notebook), note_path(new)
    if not os.path.exists(src):
        return err('笔记本不存在', 404)
    if os.path.exists(dst):
        return err('目标名称已存在', 409)
    os.replace(src, dst)
    old_hist = os.path.join(HISTORY_DIR, notebook)
    if os.path.isdir(old_hist):
        os.replace(old_hist, os.path.join(HISTORY_DIR, new))
    return ok(name=new, version=note_version(dst))


@app.route('/notebooks/<notebook>', methods=['DELETE'])
def delete_notebook(notebook):
    if not valid_name(notebook):
        return err('非法的笔记本名称')
    p = note_path(notebook)
    if not os.path.exists(p):
        return err('笔记本不存在', 404)
    if len(list_notebooks()) <= 1:
        return err('至少保留一个笔记本')
    os.unlink(p)
    # 历史一起清掉，避免敏感内容残留在没有入口的目录里
    shutil.rmtree(os.path.join(HISTORY_DIR, notebook), ignore_errors=True)
    return ok()


@app.route('/load/<notebook>', methods=['GET'])
def load_note(notebook):
    if not valid_name(notebook):
        return err('非法的笔记本名称')
    p = note_path(notebook)
    return ok(content=read_note(p), version=note_version(p))


@app.route('/save', methods=['POST'])
def save_note():
    data = request.get_json(silent=True)
    if data is None:
        return err('请求体必须是 JSON')
    notebook = data.get('notebook', DEFAULT_NOTEBOOKS[0])
    content = data.get('content', '')
    client_version = data.get('version')
    force = bool(data.get('force'))
    if not valid_name(notebook):
        return err('非法的笔记本名称')
    if not isinstance(content, str):
        return err('content 必须是字符串')

    p = note_path(notebook)
    current = note_version(p)
    # 冲突检测：客户端带了版本、且文件确实存在、且不一致
    if not force and client_version is not None and current is not None and str(client_version) != current:
        return err('笔记本已在别处被修改', 409, version=current, content=read_note(p))

    if read_note(p) == content and current is not None:
        return ok(version=current, unchanged=True)

    try:
        snapshot(notebook)
        atomic_write(p, content)
    except Exception as e:  # noqa: BLE001
        return err(str(e), 500)
    return ok(version=note_version(p))


@app.route('/history/<notebook>', methods=['GET'])
def history_list(notebook):
    if not valid_name(notebook):
        return err('非法的笔记本名称')
    hist = os.path.join(HISTORY_DIR, notebook)
    items = []
    if os.path.isdir(hist):
        for fn in sorted(os.listdir(hist), reverse=True):
            if fn.endswith('.txt'):
                items.append({'id': fn[:-4], 'size': os.path.getsize(os.path.join(hist, fn))})
    return ok(history=items)


def history_file(notebook, hid):
    if not valid_name(notebook) or not re.match(r'^[0-9\-]{1,32}$', hid):
        return None
    return os.path.join(HISTORY_DIR, notebook, f'{hid}.txt')


@app.route('/history/<notebook>/<hid>', methods=['GET'])
def history_get(notebook, hid):
    p = history_file(notebook, hid)
    if p is None:
        return err('非法参数')
    if not os.path.exists(p):
        return err('历史版本不存在', 404)
    return ok(content=read_note(p))


@app.route('/history/<notebook>/<hid>', methods=['DELETE'])
def history_delete(notebook, hid):
    p = history_file(notebook, hid)
    if p is None:
        return err('非法参数')
    if not os.path.exists(p):
        return err('历史版本不存在', 404)
    os.unlink(p)
    return ok()


@app.route('/history/<notebook>', methods=['DELETE'])
def history_clear(notebook):
    if not valid_name(notebook):
        return err('非法的笔记本名称')
    hist = os.path.join(HISTORY_DIR, notebook)
    if os.path.isdir(hist):
        for fn in os.listdir(hist):
            if fn.endswith('.txt'):
                os.unlink(os.path.join(hist, fn))
    return ok()


if __name__ == '__main__':
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(debug=debug, port=int(os.environ.get('PORT', '12345')), host='0.0.0.0')
