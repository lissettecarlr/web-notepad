from flask import Flask, render_template, request, jsonify
import os
import time

app = Flask(__name__)

NOTES_DIR = "notes"
if not os.path.exists(NOTES_DIR):
    os.makedirs(NOTES_DIR)

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

if __name__ == '__main__':
    app.run(debug=True, port=12345, host='0.0.0.0')