# 在线笔记本 Web Notepad

一个简单好用的在线 web 笔记本，用于快速记录和保存临时信息。

## ✨ 功能特性

- **多笔记本** - 默认三个，可随时新建（`＋`）、双击重命名、删除
- **自动保存** - 停止编辑 2 秒后自动保存；`Ctrl+S` 立即保存；切换标签 / 关闭页面前自动落盘
- **冲突检测** - 多端同时编辑时不会互相覆盖，会提示"加载远端 / 本地覆盖"
- **本地草稿** - 网络断了照样写，内容存在浏览器里，下次打开提示恢复
- **历史版本** - 每次保存前自动快照（默认保留 20 份），可查看并一键恢复
- **Markdown** - 编辑 / 分栏 / 预览三种模式，代码高亮，输出经 DOMPurify 消毒
- **主题切换** - 浅色 / 深色，跟随系统偏好，代码块主题同步切换
- **访问令牌** - 设置 `NOTEPAD_TOKEN` 后需要口令才能读写
- **零外部依赖** - 前端库全部内置，内网 / 离线环境可用

![边界效果展示](./images/2.gif)

## 🚀 快速开始

### 本地运行

```bash
git clone https://github.com/lissettecarlr/web-notepad.git
cd web-notepad
pip install -r requirements.txt

# 开发
python app.py

# 生产（多进程）
gunicorn -b 0.0.0.0:12345 -w 2 --threads 4 app:app
```

访问 http://localhost:12345

### Docker

```bash
mkdir web-notepad && cd web-notepad
wget https://raw.githubusercontent.com/lissettecarlr/web-notepad/main/docker-compose.yml
# 编辑 docker-compose.yml 里的 NOTEPAD_TOKEN
docker compose up -d
```

或者：

```bash
docker run -d -p 12345:12345 \
  -v $(pwd)/notes:/app/notes \
  -e NOTEPAD_TOKEN=your-secret \
  lissettecarlr/web-notepad:latest
```

> 容器启动时会自动修正 `notes/` 目录权限并降权运行，无需手动 `chown`。想让笔记文件归宿主机某个用户，传 `PUID` / `PGID` 即可。

### 发新版本镜像（GitHub Actions → Docker Hub）

推一个 semver tag 就会自动构建 `linux/amd64` + `linux/arm64` 并推到 `lissettecarlr/web-notepad`：

```bash
git tag v0.1.7
git push origin v0.1.7
```

会打上 `0.1.7`、`0.1`、`latest` 三个 tag。不想打 git tag 也可以去 GitHub → Actions → Docker → Run workflow，手动填版本号。

仓库需要两个 Secrets（Settings → Secrets and variables → Actions）：

| Secret | 值 |
| --- | --- |
| `DOCKERHUB_USERNAME` | Docker Hub 用户名（`lissettecarlr`） |
| `DOCKERHUB_TOKEN` | [Hub Access Token](https://hub.docker.com/settings/security)，权限 Read & Write |

### Cloudflare Workers（免服务器）

前端静态文件和 API 都由一个 Worker 提供，数据存 KV。

```bash
cd worker
npm install
npx wrangler kv namespace create NOTES_KV     # 把输出的 id 填进 wrangler.toml
npx wrangler secret put NOTEPAD_TOKEN         # 可选，但公网强烈建议
npx wrangler deploy
```

> KV 是最终一致存储，多端秒级并发编辑时冲突检测是尽力而为；单人使用没有问题。

## ⚙️ 环境变量（Flask 版）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NOTEPAD_TOKEN` | 空 | 访问令牌，为空则不鉴权 |
| `NOTES_DIR` | `./notes` | 笔记存放目录 |
| `HISTORY_KEEP` | `20` | 每个笔记本保留的历史快照数 |
| `MAX_NOTE_BYTES` | `5242880` | 单次请求体上限 |
| `PORT` | `12345` | 监听端口（仅 `python app.py`） |
| `PUID` / `PGID` | `1000` | 容器内运行用户（仅 Docker） |
| `FLASK_DEBUG` | `0` | 设为 `1` 开启调试，**不要在公网开** |

## 📁 数据布局

```
notes/
├── notebook1.txt
├── notebook2.txt
└── .history/
    └── notebook1/
        ├── 20260910-134501.txt
        └── ...
```

纯文本，随时可以直接备份或用其他编辑器打开。

## 🔌 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/notebooks` | 列出笔记本 |
| POST | `/notebooks` | 新建 `{name}` |
| PATCH | `/notebooks/<name>` | 重命名 `{name}` |
| DELETE | `/notebooks/<name>` | 删除（先做快照） |
| GET | `/load/<name>` | 读取，返回 `content` + `version` |
| POST | `/save` | `{notebook, content, version, force?}`，版本不一致返回 409 |
| GET | `/history/<name>` | 历史列表 |
| GET | `/history/<name>/<id>` | 历史内容 |
设置了令牌时所有 API 需带 `Authorization: Bearer <token>`。
