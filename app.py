import hmac
import os
import re
import shutil
import tempfile
import time

from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, 'public')
NOTES_DIR = os.environ.get('NOTES_DIR', os.path.join(BASE_DIR, 'notes'))
HISTORY_DIR = os.path.join(NOTES_DIR, '.history')
HISTORY_KEEP = int(os.environ.get('HISTORY_KEEP', '20'))
TOKEN = os.environ.get('NOTEPAD_TOKEN', '')
DEFAULT_NOTEBOOKS = ['notebook1', 'notebook2', 'notebook3']

NOTEBOOK_RE = re.compile(r'^[a-zA-Z0-9_\-\u4e00-\u9fa5]{1,64}$')

os.makedirs(HISTORY_DIR, exist_ok=True)

app = Flask(__name__, static_folder=PUBLIC_DIR, static_url_path='')
app.config['MAX_CONTENT_LENGTH'] = int(os.environ.get('MAX_NOTE_BYTES', str(5 * 1024 * 1024)))


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
        with open(path, 'r', encoding='utf-8', newline='') as f:
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


def list_notebooks():
    names = []
    for fn in os.listdir(NOTES_DIR):
        if fn.endswith('.txt') and NOTEBOOK_RE.match(fn[:-4]):
            names.append(fn[:-4])
    if not names:
        for n in DEFAULT_NOTEBOOKS:
            atomic_write(note_path(n), '')
        names = list(DEFAULT_NOTEBOOKS)
    names.sort(key=lambda s: (len(s), s) if s.startswith('notebook') else (999, s))
    result = []
    for n in names:
        p = note_path(n)
        st = os.stat(p)
        result.append({'name': n, 'version': str(st.st_mtime_ns), 'size': st.st_size})
    return result


def valid_name(name):
    return isinstance(name, str) and NOTEBOOK_RE.match(name) is not None


# ---------- auth ----------

@app.before_request
def check_auth():
    if not TOKEN:
        return None
    if request.method == 'OPTIONS':
        return None
    # 静态资源与首页放行
    if request.endpoint in ('index', 'static'):
        return None
    header = request.headers.get('Authorization', '')
    supplied = header[7:] if header.startswith('Bearer ') else ''
    if not hmac.compare_digest(supplied, TOKEN):
        return err('未授权', 401)
    return None


@app.after_request
def no_cache(resp):
    if request.path.startswith(('/load/', '/notebooks', '/history/')):
        resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.errorhandler(413)
def too_large(_):
    return err('内容过大', 413)


# ---------- routes ----------

@app.route('/')
def index():
    return send_from_directory(PUBLIC_DIR, 'index.html')


@app.route('/notebooks', methods=['GET'])
def notebooks():
    return ok(notebooks=list_notebooks())


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
    snapshot(notebook)  # 删除前留一份历史
    os.unlink(p)
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
    notebook = data.get('notebook', 'notebook1')
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


@app.route('/history/<notebook>/<hid>', methods=['GET'])
def history_get(notebook, hid):
    if not valid_name(notebook) or not re.match(r'^[0-9\-]{1,32}$', hid):
        return err('非法参数')
    p = os.path.join(HISTORY_DIR, notebook, f'{hid}.txt')
    if not os.path.exists(p):
        return err('历史版本不存在', 404)
    return ok(content=read_note(p))


if __name__ == '__main__':
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    app.run(debug=debug, port=int(os.environ.get('PORT', '12345')), host='0.0.0.0')
