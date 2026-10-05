# MIT - Model IQ Test

模型降智测试：配置模型接口，选择固定测试，查看原始回答及确定性验证结果。

提供红绿色盲、糖果和鹈鹕三项测试，支持多选、独立并发请求与单项重试。文字测试按固定关键词或字符串规则验证；鹈鹕测试仅检查 HTML/SVG 格式，画面和动画由用户查看，不提供智商分数或主观评分。

## 本地运行

需要 Node.js 22 或更新版本，无第三方运行时依赖，无需执行 `npm install`。

```sh
npm start
```

打开 `http://127.0.0.1:8080`。Windows 也可运行 `./start-local.ps1`。

打开 `http://127.0.0.1:8080/?demo=1` 可查看预置回答演示；演示不调用真实 API，也不代表真实模型能力。

## API 与凭据

支持 OpenAI Responses 与 Anthropic Messages 协议。请求通过浏览器 → 同源 `/api/model` → 公网 HTTPS 上游接口。

API Key 会经过本站服务器，仅在页面和服务端请求期间的内存中使用，不写入应用日志、文件或浏览器持久存储。连接检查与真实测试均需用户主动触发。模型生成的 HTML 在受限 sandbox iframe 中预览。

## 验证

```sh
npm test
```

自动化测试使用本地模拟服务和合成凭据，不调用真实模型；通过本地测试不代表所有供应商均兼容。

## 部署与文档

部署需要 Node.js 长进程或 Docker，网页和 API 必须保持同源。纯静态托管无法提供完整服务。

- [API.md](API.md)：接口、提示词缓存、启动、部署及验证说明。
- [DESIGN.md](DESIGN.md)：项目视觉规范。
- [AGENTS.md](AGENTS.md)：项目 Agent 工作规范。

本地生成的 `output/` 截图、日志和凭据文件不纳入 Git。
