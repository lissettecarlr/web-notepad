let timer = null;
let currentNotebook = 'notebook1';
const notepad = document.getElementById('notepad');
const status_show = document.getElementById('status');
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
    status_show.textContent = '正在加载...';
    
    fetch(`/load/${notebook}`)
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                notepad.value = data.content;
                if (isPreviewMode) {
                    updatePreview();
                }
                status_show.textContent = '加载完成';
            } else {
                status_show.textContent = '加载失败：' + data.message;
            }
        })
        .catch(error => {
            status_show.textContent = '加载出错：' + error;
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
            status_show.textContent = '已自动保存 - ' + new Date().toLocaleTimeString();
        } else {
            status_show.textContent = '保存失败：' + data.message;
        }
    })
    .catch(error => {
        // 检查当前笔记本是否仍然是开始保存时的笔记本
        if (savingNotebook !== currentNotebook) {
            console.log('笔记本已切换，取消保存操作');
            return;
        }
        status_show.textContent = '保存出错：' + error;
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
    
    // 更新预览按钮的图标和文本
    const iconElement = previewToggle.querySelector('.file-icon');
    const textElement = previewToggle.querySelector('.btn-text');
    
    if (isPreviewMode) {
        iconElement.textContent = '✏️';
        textElement.textContent = '编辑';
        updatePreview();
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    } else {
        iconElement.textContent = '📝';
        textElement.textContent = '预览';
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

// 文件操作相关代码
document.getElementById('upload-btn').addEventListener('click', () => {
    document.getElementById('file-upload').click();
});

document.getElementById('file-upload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // 检查文件大小
    const maxSize = 500 * 1024 * 1024; // 500MB
    if (file.size > maxSize) {
        status_show.textContent = `文件过大，最大支持500MB`;
        return;
    }
    
    // 弹出密码输入框
    const password = prompt('请输入上传密码：');
    if (!password) {
        status_show.textContent = '已取消上传';
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('password', password);
    
    try {
        status_show.textContent = '正在上传...';
        
        // 添加超时控制
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60秒超时
        
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData,
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`服务器返回错误: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        if (data.status === 'success') {
            const {name, size, type} = data.fileInfo;
            status_show.textContent = `✅ 文件上传成功 - ${name} (${size}, ${type})`;
            await updateFileButtons();
        } else {
            status_show.textContent = `❌ 上传失败：${data.message}`;
        }
    } catch (error) {
        console.error('Upload error:', error);
        if (error.name === 'AbortError') {
            status_show.textContent = `❌ 上传超时，请稍后重试或尝试小一点的文件`;
        } else if (error.message.includes('Failed to fetch')) {
            status_show.textContent = `❌ 连接服务器失败，请检查网络连接`;
        } else {
            status_show.textContent = `❌ 上传出错：${error.message}`;
        }
    }
});

document.getElementById('download-btn').addEventListener('click', async () => {
    try {
        window.location.href = '/download';
    } catch (error) {
        status_show.textContent = '下载出错：' + error;
    }
});

document.getElementById('clear-btn').addEventListener('click', async () => {
    try {
        const response = await fetch('/clear-file');
        const data = await response.json();
        if (data.status === 'success') {
            status_show.textContent = '文件已清除';
            await updateFileButtons(); // 更新按钮状态
        } else {
            status_show.textContent = '清除失败：' + data.message;
        }
    } catch (error) {
        status_show.textContent = '清除出错：' + error;
    }
});

// 添加文件状态检查函数
async function updateFileButtons() {
    try {
        const response = await fetch('/check-file');
        const data = await response.json();
        
        const downloadBtn = document.getElementById('download-btn');
        const clearBtn = document.getElementById('clear-btn');
        
        if (data.hasFile) {
            downloadBtn.style.display = 'inline-flex';
            clearBtn.style.display = 'inline-flex';
        } else {
            downloadBtn.style.display = 'none';
            clearBtn.style.display = 'none';
        }
    } catch (error) {
        console.error('检查文件状态失败:', error);
    }
}

// 页面加载时检查文件状态
document.addEventListener('DOMContentLoaded', updateFileButtons);