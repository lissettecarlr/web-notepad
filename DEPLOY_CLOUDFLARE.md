# Cloudflare 部署指南

本指南将帮助你将这个记事本应用部署到 Cloudflare，实现跨设备同步功能。

## 架构说明

- **Cloudflare Pages**: 托管前端静态文件（HTML/CSS/JS）
- **Cloudflare Workers**: 提供 API 后端服务
- **Cloudflare KV**: 存储笔记数据（支持跨设备同步）

## 前置要求

1. Cloudflare 账号（免费）
2. GitHub 仓库（用于自动部署）
3. Node.js 和 npm（用于本地测试，可选）

## 部署步骤

### 第一步：创建 KV Namespace

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** → **KV**
3. 点击 **Create a namespace**
4. 输入名称：`NOTES_KV`
5. 创建后，记录下 **Namespace ID**（格式类似：`xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`）

### 第二步：部署 Workers（API 后端）

#### 方式一：通过 GitHub 自动部署（推荐）

1. 在 Cloudflare Dashboard 中，进入 **Workers & Pages**
2. 点击 **Create application** → **Create Worker**
3. 选择 **Connect to Git**
4. 授权 GitHub 并选择你的仓库
5. 配置：
   - **Project name**: `notebook-api`
   - **Production branch**: `main` 或 `master`
   - **Build command**: 留空
   - **Root directory**: `worker`
6. 在 **Settings** → **Variables** → **KV Namespace Bindings** 中：
   - 点击 **Add binding**
   - **Variable name**: `NOTES_KV`
   - **KV namespace**: 选择刚才创建的 `NOTES_KV`
7. 点击 **Save and deploy**

#### 方式二：使用 Wrangler CLI（本地部署）

1. 安装 Wrangler：
   ```bash
   npm install -g wrangler
   ```

2. 登录 Cloudflare：
   ```bash
   wrangler login
   ```

3. 创建 KV Namespace（如果还没创建）：
   ```bash
   wrangler kv:namespace create "NOTES_KV"
   ```
   记录返回的 ID

4. 编辑 `worker/wrangler.toml`，将 `YOUR_KV_NAMESPACE_ID` 替换为实际的 Namespace ID

5. 部署 Worker：
   ```bash
   cd worker
   wrangler deploy
   ```

6. 部署成功后，记录 Worker 的 URL（格式：`https://notebook-api.your-account.workers.dev`）

### 第三步：配置 Workers URL

1. 打开 `public/script.js`
2. 找到第 3 行的 `API_BASE_URL`
3. 将 `YOUR_WORKER_NAME` 替换为你的 Worker URL，例如：
   ```javascript
   const API_BASE_URL = 'https://notebook-api.your-account.workers.dev';
   ```
   或者如果你使用了自定义域名：
   ```javascript
   const API_BASE_URL = 'https://api.yourdomain.com';
   ```

### 第四步：部署前端到 Pages

#### 方式一：通过 GitHub 自动部署（推荐）

1. 在 Cloudflare Dashboard 中，进入 **Workers & Pages**
2. 点击 **Create application** → **Pages** → **Connect to Git**
3. 授权 GitHub 并选择你的仓库
4. 配置：
   - **Project name**: `web-notepad`（或你喜欢的名称）
   - **Production branch**: `main` 或 `master`
   - **Build command**: 留空（纯静态文件，无需构建）
   - **Build output directory**: `public`
5. 点击 **Save and deploy**

#### 方式二：直接上传文件

1. 在 Cloudflare Dashboard 中，进入 **Workers & Pages** → **Pages**
2. 点击 **Create a project** → **Upload assets**
3. 将 `public` 目录下的所有文件打包成 zip 上传

### 第五步：配置自定义域名（可选）

1. 在 Pages 项目中，进入 **Custom domains**
2. 添加你的域名
3. 按照提示配置 DNS 记录

4. 如果使用自定义域名，记得更新 `public/script.js` 中的 `API_BASE_URL`

## 验证部署

1. 访问你的 Pages URL（例如：`https://web-notepad.pages.dev`）
2. 在 A 电脑上输入一些文本
3. 在 B 电脑上打开同一页面，应该能看到刚才输入的内容

## 注意事项

1. **KV 存储限制**：
   - 单个值最大 25MB（笔记内容足够）

2. **免费额度**：
   - KV: 每天 10 万次读取，1,000 次写入
   - Workers: 每天 10 万次请求
   - Pages: 无限请求
   - 对于个人使用通常足够

3. **CORS**：
   - Workers 代码已经包含了 CORS 头，允许跨域请求

## 故障排查

### 问题：无法加载笔记
- 检查 `public/script.js` 中的 `API_BASE_URL` 是否正确
- 检查 Workers 是否正常部署
- 打开浏览器控制台查看错误信息

### 问题：保存失败
- 检查 KV Namespace 是否正确绑定到 Worker
- 检查 Workers 日志（在 Dashboard 中查看）

## 更新代码

如果使用 GitHub 自动部署，只需要：
1. 修改代码
2. 推送到 GitHub
3. Cloudflare 会自动重新部署

## 成本

- **免费套餐**：对于个人使用完全免费
- **付费套餐**：如果需要更多请求或存储，按量计费，价格很低

## 参考链接

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Cloudflare Pages 文档](https://developers.cloudflare.com/pages/)
- [Cloudflare KV 文档](https://developers.cloudflare.com/kv/)
