# 在线笔记本 Web Notepad (Cloudflare 版)

一个简单好用的在线 web 笔记本，部署在 Cloudflare 上实现跨设备同步。

## 功能特性

- **三页笔记本** - 提供三个独立的笔记页面，方便分类记录
- **自动保存** - 停止编辑 2 秒后自动保存，无需手动操作
- **Markdown 支持** - 内置 Markdown 编辑和预览功能，支持代码高亮
- **主题切换** - 支持浅色/深色主题自由切换
- **跨设备同步** - 数据存储在 Cloudflare KV，随时随地访问

## 架构

- **Cloudflare Pages** - 托管前端静态文件
- **Cloudflare Workers** - 提供 API 后端
- **Cloudflare KV** - 存储笔记数据

## 快速部署

### 1. Fork 本仓库

### 2. 创建 KV Namespace

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. **Workers & Pages** → **KV** → **Create a namespace**
3. 名称填 `NOTES_KV`

### 3. 部署 Worker (API 后端)

1. **Workers & Pages** → **Create application** → **Import a Git repository**
2. 选择你 fork 的仓库
3. 配置：
   - **Worker name**: `notebook-api`
   - **Production branch**: `main`
   - **Root directory**: `worker`
   - **Build command**: `npm install && npm run deploy`
4. 部署后，进入 Worker → **Settings** → **Bindings** → **Add** → **KV Namespace**
   - Variable name: `NOTES_KV`
   - 选择刚才创建的 KV namespace

### 4. 部署 Pages (前端)

1. **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
2. 选择同一个仓库
3. 配置：
   - **Project name**: `web-notepad`
   - **Production branch**: `main`
   - **Root directory**: `public`
   - **Build command**: `bash build.sh`
   - **Build output directory**: `.`
4. **Settings** → **Environment variables** 添加：
   - `API_BASE_URL` = `https://notebook-api.你的账号.workers.dev`

### 5. 访问

部署成功后访问 `https://web-notepad.pages.dev`

## 免费额度

Cloudflare 免费套餐对个人使用完全足够：
- KV: 每天 10 万次读取，1,000 次写入
- Workers: 每天 10 万次请求
- Pages: 无限请求

## 其他部署方式

如需 Docker/本地部署，请切换到 `main` 分支。

## License

MIT
