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

// 添加一个加载状态标志
let isLoading = false;

// 添加一个变量来追踪保存时的笔记本
let savingNotebook = null;

function loadNotebook(notebook) {
    // 设置加载状态为true
    isLoading = true;
    status.textContent = '正在加载...';
    
    fetch(`/load/${notebook}`)
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                notepad.value = data.content;
                if (isPreviewMode) {
                    updatePreview();
                }
                status.textContent = '加载完成';
            } else {
                status.textContent = '加载失败：' + data.message;
            }
        })
        .catch(error => {
            status.textContent = '加载出错：' + error;
        })
        .finally(() => {
            // 加载完成后，无论成功失败，都将加载状态设为false
            isLoading = false;
        });
}

function autoSave() {
    // 如果正在加载中，不执行保存操作
    if (isLoading) {
        return;
    }
    
    // 记录开始保存时的笔记本
    savingNotebook = currentNotebook;
    const content = notepad.value;
    
    fetch('/save', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            content: content,
            notebook: savingNotebook
        })
    })
    .then(response => response.json())
    .then(data => {
        // 检查当前笔记本是否仍然是开始保存时的笔记本
        if (savingNotebook !== currentNotebook) {
            console.log('笔记本已切换，取消保存操作');
            return;
        }
        
        if (data.status === 'success') {
            status.textContent = '已自动保存 - ' + new Date().toLocaleTimeString();
        } else {
            status.textContent = '保存失败：' + data.message;
        }
    })
    .catch(error => {
        // 检查当前笔记本是否仍然是开始保存时的笔记本
        if (savingNotebook !== currentNotebook) {
            console.log('笔记本已切换，取消保存操作');
            return;
        }
        status.textContent = '保存出错：' + error;
    })
    .finally(() => {
        savingNotebook = null;
    });
}

// 标签切换事件
tabButtons.forEach(button => {
    button.addEventListener('click', () => {
        // 如果之前的定时器存在，清除它
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        
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
    
    // 如果进入预览模式，清除现有的定时器
    if (isPreviewMode) {
        updatePreview();
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    }
});

// 修改输入事件处理
notepad.addEventListener('input', () => {
    if (isPreviewMode) {
        updatePreview();
        return; // 预览模式下不启动自动保存
    }
    
    // 只在编辑模式下执行自动保存
    if (timer) {
        clearTimeout(timer);
    }
    timer = setTimeout(autoSave, 2000);
}); 