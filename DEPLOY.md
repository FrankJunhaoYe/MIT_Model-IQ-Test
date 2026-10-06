# 服务器部署交接：Ubuntu / Docker / Nginx Proxy Manager / Cloudflare

本文供服务器上的 OpenCode 和维护者执行。目标是部署 MIT，不修改测试规则、页面设计或现有其他服务。

## 先检查当前环境

1. 阅读 `AGENTS.md`、`API.md`、`Dockerfile`、`compose.yaml` 和 `.env.example`。
2. 检查 Docker Engine、Compose 插件、现有 Nginx Proxy Manager（NPM）容器及其网络、80/443 端口占用、项目目录和 Git 状态。已有组件不要重装或重置；不要停止其他项目。
3. 获取维护者指定的实际域名。当前仓库没有指定生产域名，不要把 `test.example.com` 当作部署地址，也不要猜测现有站点中的哪个域名可用于本项目。
4. 当前 Compose 适用于 NPM 在同一 Docker 主机上的情况。如果实际布局不同，先报告差异并调整网络接入方案，不把 NPM 容器内的 `127.0.0.1` 当作 MIT 地址。

检查命令（替换尖括号占位符后执行）：

```sh
docker version
docker compose version
docker ps
docker network ls
docker inspect <NPM容器名> --format '{{json .NetworkSettings.Networks}}'
```

## 拉取与启动

新部署可克隆到 `/opt/mit`，如果路径已存在，先检查内容，不覆盖：

```sh
git clone https://github.com/FrankJunhaoYe/MIT.git /opt/mit
cd /opt/mit
```

已有项目先检查 `git status --short`、`git branch --show-current` 和 `git remote -v`；确认 main 分支与正确远端后使用 `git pull --ff-only origin main`。有本地修改或分叉时先报告，不执行强制重置或清理。

`.env` 不存在时才从 `.env.example` 复制；已有配置先备份并保留。填写：

- `PUBLIC_ORIGIN=https://实际域名`：无页面路径和尾部斜杠，与浏览器访问来源一致。
- `NPM_NETWORK=实际网络名`：选择现有 NPM 已连接的 Docker 网络。
- `MIT_ALLOWED_ORIGINS=*`：默认允许公网 HTTPS 模型 API；如维护者已有明确限制，保留其限制。

不要在 `.env`、命令行、Git 或日志中写入模型 API Key。页面由使用者自行输入 Key。

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose exec -T mit node -e "fetch('http://127.0.0.1:8080/api/health').then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
```

容器默认通过 NPM 网络提供服务，不发布宿主机 8080。`restart: unless-stopped` 提供进程异常退出后的重启；healthy 状态由探针报告，unhealthy 本身不触发重启。

## NPM 与域名

创建本项目独立 Proxy Host，不覆盖其他站点：

| NPM 字段 | 配置 |
| --- | --- |
| Domain Names | 维护者指定的实际域名 |
| Scheme | `http` |
| Forward Hostname / IP | `mit-model-iq-test` |
| Forward Port | `8080` |
| SSL | 有效证书，开启 Force SSL |

Advanced 配置见 `API.md` 对应章节：读取超时 190 秒、关闭响应缓冲和缓存、请求大小 2 MB。不要重复添加 `location /`；保存后检查 NPM 的 Nginx 配置有效，确认 Host 保留为实际访问域名。调整现有 NPM 配置前保留备份，不直接覆盖其数据库或批量改生成配置。

Cloudflare A 记录指向服务器公网 IPv4；没有可用 IPv6 不添加 AAAA。首次验收建议灰云（仅 DNS），仍由 NPM 提供 HTTPS。若启用橙云，使用 Full (strict)，API 不缓存；Cloudflare 自身超时不受 NPM 的 190 秒设置控制。Cloudflare DNS Token 只在确有需要时通过 NPM 的安全配置入口设置，不提交仓库或输出。

若没有权限配置 NPM 或 Cloudflare，完成可以执行的容器部署和检查，然后列出准确的待填字段交给维护者；不要宣称公网已上线。

## 验收与报告

- 源码检查：Node.js 22+ 环境运行 `npm test`；镜像不包含测试文件，可在宿主机运行，或通过临时 Node 容器只读挂载源码运行。不能沿用历史通过数量。
- Docker 构建成功，服务 healthy，容器内健康接口成功。
- 公网 `/api/health` 返回 200 和 `ok: true`；主页面、CSS、JavaScript（包括 `result-renderer.js`）可加载。
- `/server.cjs`、`/.env`、`/compose.yaml`、`/tests/server.test.cjs` 返回 404。
- 浏览器核验 `?demo=1` 的选择、结果页、单项重新演示；具备浏览器工具时检查桌面和 390px、明暗主题及弹窗。
- 真实模型测试由用户在网页输入有效 Key；只有得到明确授权才调用真实供应商。需分别验证 Responses、Messages 和鹈鹕长回答。模拟与健康检查不能证明真实生成兼容。
- 当前经同一 NPM IP 的访客共享 3 个并发与每分钟 30 次限制，报告此限制；不要在部署时顺手放宽或直接信任任意转发 IP 头。

最终报告实际域名、部署目录、Git 提交、NPM 网络、容器状态、已执行验收及待办；不包含任何凭据。未执行浏览器、真实 API 或公网验证时明确写出。

更新使用 `docker compose up -d --build`。部署前记录上一版本提交并保留配置备份；回退时用该提交的独立源码目录重建，沿用审核过的配置与 Compose 项目名。不要使用 `docker system prune` 或清理其他项目的数据。
