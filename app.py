from flask import Flask, render_template, request, jsonify, send_from_directory
import os
import re

app = Flask(__name__)

NOTES_DIR = "notes"
if not os.path.exists(NOTES_DIR):
    os.makedirs(NOTES_DIR)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/load/<notebook>', methods=['GET'])
def load_note(notebook):
    if not re.match(r'^[a-zA-Z0-9_-]+$', notebook):
        return jsonify({"status": "error", "message": "非法的笔记本名称"})
    filepath = os.path.join(NOTES_DIR, f"{notebook}.txt")
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except FileNotFoundError:
        content = ""
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)})
    return jsonify({"status": "success", "content": content})

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

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(os.path.join(app.root_path, 'static'),
                              'favicon.ico', mimetype='image/x-icon')

if __name__ == '__main__':
    app.run(debug=os.environ.get('FLASK_DEBUG', '1') == '1', port=12345, host='0.0.0.0')