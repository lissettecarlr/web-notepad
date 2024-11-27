let timer = null;
let currentNotebook = 'notebook1';
const notepad = document.getElementById('notepad');
const status = document.getElementById('status');
const tabButtons = document.querySelectorAll('.tab-btn');

// 主题切换功能
const themeToggle = document.getElementById('theme-toggle');
const html = document.documentElement;

// 从本地存储加载主题设置
const savedTheme = localStorage.getItem('theme') || 'light';
html.setAttribute('data-theme', savedTheme);

themeToggle.addEventListener('click', () => {
    const currentTheme = html.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
});

function loadNotebook(notebook) {
    fetch(`/load/${notebook}`)
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                notepad.value = data.content;
                if (isPreviewMode) {
                    updatePreview();
                }
            } else {
                status.textContent = '加载失败：' + data.message;
            }
        })
        .catch(error => {
            status.textContent = '加载出错：' + error;
        });
}

function autoSave() {
    const content = notepad.value;
    
    fetch('/save', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            content: content,
            notebook: currentNotebook
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            status.textContent = '已自动保存 - ' + new Date().toLocaleTimeString();
        } else {
            status.textContent = '保存失败：' + data.message;
        }
    })
    .catch(error => {
        status.textContent = '保存出错：' + error;
    });
}

// 标签切换事件
tabButtons.forEach(button => {
    button.addEventListener('click', () => {
        // 保存当前笔记本
        autoSave();
        
        // 更新标签样式
        tabButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        
        // 加载新笔记本
        currentNotebook = button.dataset.notebook;
        loadNotebook(currentNotebook);
    });
});

notepad.addEventListener('input', () => {
    if (timer) {
        clearTimeout(timer);
    }
    timer = setTimeout(autoSave, 2000);
});

// 初始加载第一个笔记本
loadNotebook(currentNotebook);

// Markdown 预览功能
const previewToggle = document.getElementById('preview-toggle');
const preview = document.getElementById('preview');
const editorContainer = document.querySelector('.editor-container');
let isPreviewMode = false;

// 配置 marked 选项
marked.setOptions({
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
    },
    breaks: true
});

function updatePreview() {
    const content = notepad.value;
    preview.innerHTML = marked.parse(content);
    document.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightBlock(block);
    });
}

previewToggle.addEventListener('click', () => {
    isPreviewMode = !isPreviewMode;
    editorContainer.classList.toggle('preview-mode');
    previewToggle.textContent = isPreviewMode ? '编辑' : '预览';
    if (isPreviewMode) {
        updatePreview();
    }
});

// 在输入时更新预览
notepad.addEventListener('input', () => {
    if (isPreviewMode) {
        updatePreview();
    }
    // 保持原有的自动保存功能
    if (timer) {
        clearTimeout(timer);
    }
    timer = setTimeout(autoSave, 2000);
}); 