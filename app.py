from flask import Flask, render_template, request, jsonify, send_from_directory
import os
import time
from werkzeug.utils import secure_filename
from flask_limiter import Limiter

app = Flask(__name__)
limiter = Limiter(app)

NOTES_DIR = "notes"
if not os.path.exists(NOTES_DIR):
    os.makedirs(NOTES_DIR)

UPLOAD_FOLDER = "uploads"
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

ALLOWED_EXTENSIONS = {'doc','docx','pdf','apk','rar','zip'}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/load/<notebook>', methods=['GET'])
def load_note(notebook):
    filepath = os.path.join(NOTES_DIR, f"{notebook}.txt")
    try:
        if os.path.exists(filepath):
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
        else:
            content = ""
        return jsonify({"status": "success", "content": content})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)})

@app.route('/save', methods=['POST'])
def save_note():
    content = request.json.get('content', '')
    notebook = request.json.get('notebook', 'notebook1')
    filepath = os.path.join(NOTES_DIR, f"{notebook}.txt")
    
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)})

@limiter.limit("10/minute")
@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"status": "error", "message": "没有选择文件"})
        
    file = request.files['file']
    if not file:
        return jsonify({"status": "error", "message": "文件无效"})
        
    # 检查文件大小
    file.seek(0, 2)  # 移到文件末尾
    size = file.tell()  # 获取大小
    file.seek(0)  # 重置文件指针
    
    if size > MAX_FILE_SIZE:
        return jsonify({"status": "error", "message": f"文件大小超过限制"})
    
    # 检查文件类型
    filename = file.filename
    ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else ''
    if ext not in ALLOWED_EXTENSIONS:
        #return jsonify({"status": "error", "message": f"不支持的文件类型，允许的类型：{', '.join(ALLOWED_EXTENSIONS)}"})
        return jsonify({"status": "error", "message": f"不支持的文件类型"})
    try:
        # 删除旧文件
        for f in os.listdir(UPLOAD_FOLDER):
            os.remove(os.path.join(UPLOAD_FOLDER, f))
        
        new_filename = f"temp.{ext}"
        file.save(os.path.join(UPLOAD_FOLDER, new_filename))
        return jsonify({
            "status": "success",
            "fileInfo": {
                "name": filename,
                "size": f"{size / 1024:.1f}KB",
                "type": ext
            }
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)})

@app.route('/download')
def download_file():
    files = os.listdir(UPLOAD_FOLDER)
    if not files:
        print("没有可下载的文件")
        return jsonify({"status": "error", "message": "没有可下载的文件"})
    
    file_path = os.path.join(UPLOAD_FOLDER, files[0])
    return send_from_directory(
        UPLOAD_FOLDER, 
        files[0],
        as_attachment=True  # 强制浏览器下载而不是打开
    )

@app.route('/clear-file')
def clear_file():
    try:
        for f in os.listdir(UPLOAD_FOLDER):
            os.remove(os.path.join(UPLOAD_FOLDER, f))
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)})

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(os.path.join(app.root_path, 'static'),
                             'favicon.ico', mimetype='./images/favicon.ico')
                            
if __name__ == '__main__':
    app.run(debug=True, port=12345, host='0.0.0.0')