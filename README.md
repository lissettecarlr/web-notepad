# 在线笔记本 Web Notepad

一个简单好用的在线 web 笔记本，用于快速记录和保存临时信息。

## ✨ 功能特性

- **多页笔记本** - 提供独立的笔记页面，方便分类记录不同内容
- **自动保存** - 停止编辑后自动保存内容，无需手动操作
- **Markdown 支持** - 内置 Markdown 编辑和预览功能，支持代码高亮
- **主题切换** - 支持浅色 / 深色主题自由切换

![边界效果展示](./images/2.gif)

## 🚀 快速开始

### 本地部署

```bash
# 克隆仓库
git clone https://github.com/lissettecarlr/web-notepad.git

# 进入项目目录
cd web-notepad

# 安装依赖
pip install -r requirements.txt

# 启动应用
python app.py
```

应用将在 http://localhost:12345 运行

### 使用 Docker 部署

#### 方式一：使用 docker-compose（推荐）

```bash
# 创建目录并进入
mkdir web-notepad && cd web-notepad

# 下载 docker-compose 配置
wget https://raw.githubusercontent.com/lissettecarlr/web-notepad/main/docker-compose.yml

# 启动容器
docker compose up -d
```

#### 方式二：直接使用 Docker 命令

```bash
docker run -d -p 12345:12345 -v $(pwd)/notes:/app/notes lissettecarlr/web-notepad:latest
```
