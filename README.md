# MIT - Model IQ Test

**模型降智测试**：用三道固定题目检查模型的实际回答，保留原始输出，并按公开规则展示验证结果。

支持 OpenAI Responses 和 Anthropic Messages 接口，可配置公网 HTTPS 中转地址。测试支持多选、独立并发运行和单项重试，展示供应商提供的 token 与缓存用量。

## 测试项目

| 测试 | 内容 | 通过规则 |
| --- | --- | --- |
| 红绿色盲 | 固定逻辑推理题 | 整段回答命中任意指定关键词，如“遗传”“染色体”“非亲生” |
| 糖果 | 按形状取糖果，保证目标组合 | 整段回答出现字符串 `21` |
| 鹈鹕 | 生成 SVG 鹈鹕骑自行车的 HTML 动画 | 回答包含 HTML 和 SVG 起始标签；画面与动画由用户查看 |

完整题目和验证器在 [test-cases.js](test-cases.js)。这些是宽松的文本与格式检查，不验证完整推导，也不提供智商分数、排行榜或 AI 裁判。失败、截断或未完成的回答保留已收到内容，不作为完整答案判题。

## 本地运行

需要 **Node.js 22 或更新版本**。项目使用原生 HTML、CSS、JavaScript 和 Node.js 内置模块，无第三方运行时依赖，无需执行 `npm install`。

```sh
git clone https://github.com/FrankJunhaoYe/MIT.git
cd MIT
npm start
```

打开 [http://127.0.0.1:8080](http://127.0.0.1:8080)。Windows 也可在项目目录运行 `./start-local.ps1`。真实 API 测试需要通过 HTTP 服务访问，不要直接双击 `index.html`。

想先体验页面，可打开 [模拟演示](http://127.0.0.1:8080/?demo=1)。演示使用预置回答，不发送真实 API 请求，也不代表真实模型能力。

## 使用

1. 打开配置弹窗，选择 Responses 或 Messages 协议。
2. 填写 API 地址、Key 和供应商支持的 Model ID。地址框已提供 `https://` 前缀，只需填写域名和路径，也支持粘贴完整 HTTPS 地址。
3. 点击连接检查，确认接口状态与实际用量。
4. 选择测试并运行，在结果页查看回答、验证结果及用量；需要时单独重试某一项。

默认启用流式接收，但在完整生成后才判题并展示 HTML 作品。页面统一发送 `low` 思考强度参数，需要模型和中转支持；不支持时会展示错误，不会自动移除参数或重复请求。缓存字段缺失显示“未提供”，不保证每次命中缓存。

## API 与凭据

请求路径：**浏览器 → 本站 `/api/model` → 公网 HTTPS 上游接口**。

API Key 会经过本站服务器，仅在页面和服务端请求期间的内存中使用，不写入应用日志、文件或浏览器持久存储。刷新或关闭页面后清除，连接检查与真实测试均需用户主动触发。部署时也应关闭代理和监控中的请求正文、认证头采集。

模型回答按安全文本或 Markdown 展示；生成的 HTML 只在带限制性 CSP 的 sandbox iframe 中预览，阻断外部资源。后端拒绝私网目标、HTTP 上游和重定向。

## 验证

```sh
npm test
```

自动化测试使用本地模拟服务和合成凭据，不调用真实模型；通过本地测试不代表所有供应商均兼容。

## 服务器部署

部署需要 Node.js 长进程或 Docker，网页和 API 必须保持同源。纯静态托管无法提供完整服务。

仓库提供 [Dockerfile](Dockerfile)、[compose.yaml](compose.yaml) 和 [.env.example](.env.example)。Ubuntu + Docker + Nginx Proxy Manager + Cloudflare 的部署流程见 [DEPLOY.md](DEPLOY.md)：填写实际域名与 NPM 网络，将流量转发到 `mit-model-iq-test:8080`，由 NPM 提供 HTTPS。

反向代理读取超时至少 190 秒，并关闭响应缓冲与 API 缓存。Cloudflare 橙云有独立的超时限制，首次验收建议使用灰云（仅 DNS）。当前经同一代理 IP 的访客共享 3 个并发名额与每分钟 30 次限制，公开多人使用前需评估。

## 文档

- [API.md](API.md)：接口、提示词缓存、启动、部署及验证说明。
- [DEPLOY.md](DEPLOY.md)：Ubuntu、Docker、Nginx Proxy Manager 和 Cloudflare 的服务器部署交接与验收清单。
- [DESIGN.md](DESIGN.md)：项目视觉规范。
- [AGENTS.md](AGENTS.md)：项目 Agent 工作规范。

本地生成的 `output/` 截图、日志和凭据文件不纳入 Git。
