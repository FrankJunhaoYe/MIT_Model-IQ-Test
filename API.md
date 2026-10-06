# API 接入与提示词缓存

## 地址和认证

| 配置 | Responses | Messages |
| --- | --- | --- |
| 官方 Base URL | `https://api.openai.com/v1` | `https://api.anthropic.com/v1` |
| 请求端点 | `POST /v1/responses` | `POST /v1/messages` |
| 认证 | `Authorization: Bearer ...` | `x-api-key: ...` |
| 版本头 | 无 | `anthropic-version: 2023-06-01` |

可以填写域名、带路径的 Base URL 或完整端点。只填域名会补 `/v1`；自定义路径保留原样；完整端点不重复拼接。协议与端点不一致时在发送前报错。服务端默认允许任意域名的公网 HTTPS 模型端点，不支持内网模型服务。这里的 responses/messages 是接口路径，不是 TCP 端口号。

配置框左侧固定显示 `https://`，输入框只填写域名和路径；输入或粘贴完整 HTTPS 地址时自动移除输入框开头的 `https://`（不区分大小写），提交时补回一个前缀。空地址及 HTTP 等其他协议在发送前报错。页头的“中转站”链接指向 `https://franklybuilds.com`，GitHub 图标链接指向 `https://github.com/FrankJunhaoYe/MIT`。

当前通过同源后端转发：浏览器 → 本站 `/api/model` → 用户指定的 API。上游不需要允许浏览器 CORS；本站转发接口不对第三方网页开放跨域。Key 会经过本站服务器，仅在服务端请求期间使用，不写入应用日志、磁盘或浏览器持久存储；服务端请求结束后释放引用。结果页在当前页面内存中保留本次配置供用户单项重试，刷新或关闭后清除，不保存到对话历史。修改地址、Key、模型、协议或流式选项都会使旧连接检查失效。重定向不会自动跟随，应填写最终 API 地址。

连接检查只发送一次 `Reply with OK only.`，输出上限为 64 token，等待上限 30 秒，不执行三道题。此前默认上限为 1024，但额度并不等于实际消耗；推理模型的内部推理也可能计入输出。配置弹窗现在显示本次实际输入、输出及供应商提供的推理、缓存用量。仅当收到明确的输出额度截断响应时显示“接口可达”，并说明尚未确认完整回答；不增加额度、不自动补发，网络中断仍显示失败。

页面发出的连接检查、三项测试和单项重试统一使用 `low` 思考强度：Responses 请求发送 `reasoning: { effort: 'low' }`，Messages 请求发送 `output_config: { effort: 'low' }`。Messages 不额外设置 thinking budget 或关闭思考。这些参数需要所选模型及中转支持；若上游拒绝，会展示接口错误，不自动移除参数或重发。`low` 不保证消除超时，现有等待上限保持不变。修改前端代码后需刷新页面，再发起新的运行，已打开的结果页仍使用原脚本。参数依据见 [OpenAI 推理参数示例](https://developers.openai.com/api/docs/guides/prompt-engineering) 和 [Claude effort 文档](https://platform.claude.com/docs/en/build-with-claude/effort)。

## 并发运行与单项重试

选中的测试在结果页开始运行时一次性显示，独立并发请求，按原选择顺序排列；每项收到完整回答后独立更新，失败不会阻止其他项。进度按已处理的项数统计，不等待前一项完成才启动下一项。

红绿色盲和糖果测试仅发送题目正文，不在提示词前附加测试名称或题目标题；测试名称只用于页面展示，避免标题提前提示推理方向。

每项提供“重试此项”，使用本次运行的配置和原题目，只替换这一项；其他结果及缓存用量保持不变。该项请求期间按钮禁用，防止重复点击；其他已完成项仍可分别重试。重试等待期间保留上次回答，完成后展示最新结果及本次用量，不把多次用量混算。没有自动重试、协议降级或题目改写。模拟运行并发展示预置回答，按钮为“重新演示此项”，不调用真实 API。

## 本地启动

需要 Node.js 22 或更新版本，没有第三方运行时依赖，不需要 `npm install`。

```powershell
cd F:\MIT
node server.cjs
```

或在 PowerShell 运行 `./start-local.ps1`。然后打开 `http://127.0.0.1:8080`，不要双击 `index.html` 做 API 测试；文件方式仍可查看模拟演示。默认仅监听本机，关闭进程即停止服务。换端口可以先设置 `$env:PORT='8081'`。

默认允许转发到任意公网 HTTPS API 域名，无需逐个添加白名单。`MIT_ALLOWED_ORIGINS=*` 同样表示允许全部域名；如部署环境已有旧白名单，将该变量改为 `*` 或移除即可恢复默认行为。维护者仍可设置逗号分隔的 HTTPS 来源列表来限制范围，设置后替换默认策略，客户端不能自行扩大范围。修改配置或服务端代码后需重启 Node 服务或重新部署。允许全部域名不会放开 HTTP、私网地址、重定向、协议端点校验或本站请求来源校验。

## 部署给客户

需要支持 Node 长进程或 Docker 的主机，不能仅上传到纯静态托管。网页和 `/api/model` 必须使用同一个网站来源。

```sh
PUBLIC_ORIGIN=https://test.example.com HOST=127.0.0.1 PORT=8080 node server.cjs
```

上例由 HTTPS 反向代理把网站根路径和 `/api/` 都转发到本机 8080。`PUBLIC_ORIGIN` 设置为客户实际访问的来源（协议、域名及非默认端口），不要添加页面路径。不要在反向代理、托管平台、APM 或调试工具中开启请求体、认证头、响应体采集；应用自身没有这些日志。

也提供 Dockerfile，例如：

```sh
docker build -t mit-model-iq-test .
docker run --rm -p 127.0.0.1:8080:8080 -e PUBLIC_ORIGIN=https://test.example.com mit-model-iq-test
```

容器默认监听 `0.0.0.0:8080`，上述映射只绑定宿主机回环地址，再接 HTTPS 反向代理。上游调用最长 180 秒，反向代理读取超时应至少为 190 秒；托管平台也必须支持这一时长。本次未发布到公网，也未实际构建 Docker 镜像。

请求限制：2 MB 输入、8 MB 响应、最多 8 个并发请求、单连接来源 IP 最多 3 个并发及每分钟 30 次。服务不信任客户端填写的转发 IP 头；经反向代理时 IP 限制可能由所有访客共享，规模化部署时应结合网关配置调整。后端核验目标来源、限制公网 IP、固定 DNS 解析结果用于 TLS 连接，并拒绝重定向及读取任意本地文件。

如果本机代理采用 Fake-IP DNS 模式，系统可能把公网域名解析到 `198.18.0.0/15` 合成地址。仅在域名的全部系统解析结果属于此范围时，服务会通过 Cloudflare HTTPS DNS 独立查询 A/AAAA；查询只包含域名，不包含 Key、请求正文或模型信息。查询结果仍须全部通过公网检查，然后固定真实公网地址建立 TLS 连接。其他私网解析结果、直接输入的合成 IP 或公共 DNS 查询失败都不会放行。

## Ubuntu + Docker Compose + Nginx Proxy Manager + Cloudflare

仓库提供 `compose.yaml` 和 `.env.example`，适用于 Nginx Proxy Manager（NPM）也运行在同一服务器 Docker 中的情况。MIT 仅通过已有 Docker 网络提供 8080，不发布宿主机端口；NPM 通过容器网络转发。服务器需安装 Docker Engine 和 Compose 插件，已有 NPM 无需重装。

1. 将源码上传或克隆到服务器目录，如 `/opt/mit`。运行 `docker ps` 找到 NPM 容器名，再运行 `docker inspect <NPM容器名> --format '{{json .NetworkSettings.Networks}}'`，选择它已经连接的 Docker 网络。
2. 在项目目录执行 `cp .env.example .env`，编辑 `.env`：`PUBLIC_ORIGIN` 改为实际访问的 `https://你的域名`（无尾部斜杠或页面路径），`NPM_NETWORK` 改为上一步的网络名。此文件不填写模型 Key；Key 由用户在网页中输入。
3. 执行 `docker compose config --quiet` 和 `docker compose up -d --build`，再用 `docker compose ps` 确认服务 healthy。容器异常退出后自动重启；healthcheck 仅报告健康状态，不会自动重启仍在运行的 unhealthy 容器。
4. NPM 新建 Proxy Host：Domain Names 为实际域名，Scheme 为 `http`，Forward Hostname 为 `mit-model-iq-test`，Forward Port 为 `8080`。不要填写 `127.0.0.1`，它在 NPM 容器中指向 NPM 自己。MIT 不需要 WebSocket；不要缓存 API。NPM 默认应保留浏览器访问的 Host；自定义代理规则也必须保留，否则服务端会拒绝来源。
5. 在 NPM 的 Advanced 填写以下指令，作用于该 Proxy Host，不再添加一个重复的 `location /`。保存后检查 NPM 没有生成配置错误：

   ```nginx
   proxy_connect_timeout 30s;
   proxy_send_timeout 190s;
   proxy_read_timeout 190s;
   proxy_buffering off;
   proxy_cache off;
   client_max_body_size 2m;
   ```

6. Cloudflare 为该域名创建 A 记录指向服务器公网 IPv4；只有服务器实际支持 IPv6 时才添加 AAAA。建议首次上线使用灰云（仅 DNS），先排除 Cloudflare 代理对长请求的影响。服务器防火墙/云安全组放行 NPM 所用的 80/443；MIT 无需公网 8080。NPM 申请有效证书并开启 Force SSL，保留 NPM 的续期配置。HTTP 验证需要 80 可达；DNS 验证可使用仅授权相应域名 DNS 编辑的 Cloudflare Token，该 Token 只配置在 NPM 中。
7. 如需橙云代理，Cloudflare SSL/TLS 使用 Full (strict)，源站须有有效证书，不使用 Flexible；确保没有对 `/api/*` 配置 Cache Everything。Cloudflare 代理有独立的响应读取超时，NPM 的 190 秒不能覆盖它；长时间无首段输出或非流式等待可能返回 524。流式也不保证一定避免超时。若出现此问题，可将这个测试子域名改为仅 DNS，保留源站 HTTPS；不改变本站 180 秒上限。

上线验收：访问 `https://你的域名/api/health` 应返回 `ok: true`，主页面与 `result-renderer.js` 可加载，`/server.cjs`、`/.env`、`/compose.yaml` 返回 404；通过 `?demo=1` 检查结果页，再在网页中使用有效 Key 检查连接、真实短题和鹈鹕长回答。两种协议分别验证，原始回答与用量需可查看。不要在命令行、日志或截图中提交真实 Key；NPM/APM 不采集请求正文或认证头。

当前限流按直接连接来源 IP 执行，不信任转发 IP 头。因此经 NPM 后，经过同一代理 IP 的访客会共享 3 个并发名额与每分钟 30 次限制。少量使用可以先保留；公开多人使用前，应另行实现可信代理范围和客户端 IP 校验，再配置网关限流，不能直接信任任意 `X-Forwarded-For`。

更新源码后运行 `docker compose up -d --build` 并重新验收；保留上一版本源码/提交以便重建回退。本地未安装 Docker，以上 Compose、NPM 和 Cloudflare 配置尚需在目标服务器验证，不能把文件检查当作镜像构建或公网验收通过。

## 连接中断与长回答排查

连接检查和三项测试默认都使用 `stream: true`，可在配置弹窗明确关闭“流式接收回答”；单项重试沿用本次配置。鹈鹕输出上限为 16384 token、单次等待上限 180 秒，短题等待上限 90 秒。Responses 和 Messages 均支持 SSE 流式解析，同源后端立即逐段转发，不等待整段生成后才发送给浏览器。部署时须为 `/api/model` 关闭反向代理响应缓冲（服务端发送 `X-Accel-Buffering: no`），代理读取超时至少 190 秒。流式可以减少长时间没有响应数据导致的中断，但若供应商不支持流式、缓冲响应或在第一段返回前断开，仍可能失败；不会自动改回非流式或重复计费重试。

用户提供的 Grok 供应商日志记录的是同步请求等待响应头超时（HTTP 499），页面另有约 61 秒连接重置。这些记录不足以确定同一故障源，不能把所有 499 解释为超时。xAI 官方支持 Responses 流式请求，见 [流式文档](https://docs.x.ai/developers/model-capabilities/text/streaming)。默认开启流式可避免本站主动选择同步等待整段答案，但不能修复供应商内部仍走同步通道、缓冲响应或自行设置的短超时；真实中转兼容性仍需用户复测。

页面仍在完整生成后展示结果和判题，未完成的 HTML 不执行。Responses 必须收到 `response.completed` 且完整响应通过校验；Messages 必须收到 `message_stop`、内容块完整结束且 stop_reason 合法，达到 token 上限或请求工具续写仍算未完成。只有 EOF 或 `[DONE]` 不算完成。中断、超时、取消及流式错误保留已解析的文本和已提供的用量；未知用量显示“未提供”。Responses 保留最终事件的原始响应（含不透明内容块），Messages 累积原始内容块、thinking 签名和工具输入，用量采用最新累计值而非逐事件相加，缺失或 null 字段不覆盖已经提供的缓存计数。流式不改变题目、缓存前缀、断点或 `store: false`。

后端错误区分 DNS、连接/TLS 握手、等待模型响应及读取响应正文，并提供固定错误代码与已用秒数，不输出原始异常信息、请求体、Key 或认证头。`ECONNRESET` 表示连接中断，不等于证书错误；具体断开来源可能是供应商、途中网关或本机网络，需要结合阶段与时间核对。TLS 错误仅在相关错误码出现时提示。未知错误使用固定通用代码，不能把未识别的异常正文带回客户端。

即使上游错误正文是 HTML，HTTP 408/504/524 也显示为上游超时，并保留 HTTP 状态，而不是误报地址或 JSON 格式问题；HTML 本身不会传回页面。本站达到自己的请求期限则显示本站超时上限。Cloudflare 524 的含义及处理见 [官方说明](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/)；若外部网关先关闭连接，增加本站等待时间不会恢复那次调用。建议核对供应商同一次请求的状态及耗时，再用“重试此项”单独复测。

## 缓存策略

- 每次运行发送新的 POST，不复用本地模型答案。`fetch.cache: no-store` 仅控制 HTTP 缓存，不禁用供应商提示词缓存。
- Responses 保留供应商默认提示词缓存。`store: false` 表示不创建可持久检索的响应状态，不代表关闭提示词缓存。不会随机改写 prompt，也不会添加时间戳破坏前缀。
- Messages 默认在最后一条消息的末尾文本块添加 `cache_control: { type: 'ephemeral' }`。已有 system/tools 缓存断点时仍会在总数少于 4 个的情况下补上对话末尾断点，避免仅缓存静态前缀。若 messages 已有显式断点则由调用者管理，不自动移动；已有 4 个断点时不追加，超过 4 个在发送前报错。不会修改原始历史。可用适配器参数 `promptCaching: false` 停止自动添加标记，适用于不支持该字段的中转服务；不会自动重试或悄悄降级。
- 默认 ephemeral 缓存有效期由供应商管理；当前 Claude 默认约 5 分钟。缓存不是永久存储，受模型、前缀、最小长度、有效期和供应商调度影响。本工具保留可复用前缀，但不能保证每次命中。不要为了命中缓存往测试题添加无意义内容。
- Messages 的短连接检查及短题可能低于该模型的最小缓存长度，即使发送了缓存标记也不会命中。中转还可能不支持缓存或不返回计数字段。这里只核验请求标记、稳定前缀和用量保留，不额外发送付费缓存探测请求；参见 [Claude 缓存要求](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)。

结果页显示供应商返回的缓存读取/写入 token。`usageDetails` 提供结构化数据，原始 `raw.usage` 也完整保留：

| 数据 | Responses | Messages |
| --- | --- | --- |
| 缓存读取 | `usage.input_tokens_details.cached_tokens` | `usage.cache_read_input_tokens` |
| 缓存写入 | `usage.input_tokens_details.cache_write_tokens`（若提供） | `usage.cache_creation_input_tokens` |
| 总输入 | `usage.input_tokens` | `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` |
| 输出中的推理 | `usage.output_tokens_details.reasoning_tokens`（若提供） | 不推测未提供的字段 |

读取为正数表示命中，0 表示未命中，缺少字段显示“未提供”，不伪装成 0。截断或失败输出不会判题，已返回的原始回答和缓存用量仍可查看。

推理 token 是输出的一部分，仅作明细展示，不重复计入总输出。回答默认按安全 Markdown 排版，支持标题、强调、列表、引用、表格、链接及代码块；原始文本可单独展开，判题始终扫描未经格式化的完整回答。HTML 和远程图片不在主页面执行或加载。鹈鹕仅在完整响应后生成带 CSP 的 `sandbox="allow-scripts"` 预览，通过核验来源窗口、opaque origin 和运行标识的消息自适应高度；预览不设内部竖向滚动窗口，由报告页滚动。高度限制为 30000px，避免不可信作品无限撑高页面。

## 后续多轮提问的接入约定

本次只准备请求层能力，未添加对话 UI 或持久化历史。现有三项测试仍是互相独立的请求。

- Responses 接受 `input` 历史数组：按原顺序保留用户输入和 `result.raw.output`，再追加新的用户问题。保持 `instructions`、模型、工具及 `prompt_cache_key`（若使用）稳定。由于 `store: false`，应完整重发历史，不依赖 `previous_response_id`。推理模型按需要传入 `include: ['reasoning.encrypted_content']` 并完整保留返回的推理条目。
- Messages 接受 `messages` 历史数组及独立 `system`。追加 assistant 消息时使用完整 `result.raw.content`，不能只用 `result.text` 丢弃 thinking 签名或工具块。原始历史不应使用每次请求构建后添加了自动缓存标记的副本。手动设置多个断点时由调用者管理位置和数量。
- 缓存不等于会话记忆；命中缓存仍需发送正确历史。失败或截断的输出不要直接作为完整 assistant 回答追加。
- Claude 显式断点的前缀查找有 20 个内容块的回溯范围；长对话一次新增大量内容块时，需要调用者合理安排额外断点。只给 system 标记不会自动缓存其后的全部对话。

## 本地验证

运行 `npm test`，使用本地 HTTP 服务和合成 Key，不调用真实模型。覆盖适配器和后端转发、端点、认证、完整正文超时、取消、异常响应、缓存统计、历史保留、允许来源、DNS 地址限制及静态文件隔离。`tests/app-run.test.cjs` 核验三项并发启动、乱序完成、单项重试、防重复提交、关闭页面清除凭据及模拟并发；后端集成测试核验三个并发名额、第四个请求受限及完成后名额释放。

`tests/streaming.test.cjs` 使用本地 HTTP SSE 和合成 HTTPS 响应，覆盖两种协议、Unicode 与 CRLF 分片、多行事件、未知事件、完整结束判定、流中错误与 EOF、网络中断、超时取消、原始内容块、累计缓存用量、8 MB 上限、逐段转发、背压和浏览器断开时取消上游。页面流程测试同时确认三项默认流式、手动关闭沿用于重试、半截 HTML 不判题及重试仍使用原题目。连接检查覆盖 64 token 额度、实际用量及“接口可达”与失败的区别。`tests/result-renderer.test.cjs` 核验 Markdown 格式、安全文本展示、隔离 CSP、自适应高度消息校验和防无限增长。

后端版本已通过同源转发集成测试，并在浏览器中用独立模拟上游核验 Responses / Messages 的连接检查、三项测试的结果页交接、并发结果及单项重试、原始回答和缓存读写用量展示；确认重试一项不修改其他结果。桌面及 390px 手机布局、明暗主题也已检查。模拟上游返回的缓存数字只验证字段保留和展示，不证明真实供应商缓存命中。

2026-10-05 本轮改动执行 JavaScript 语法检查和 `npm test`，109 项全部通过。在浏览器中使用合成上游核验两种协议的 64 token 连接检查、实际用量、并发结果、中断后不创建作品 iframe、完整重试后才预览及缓存计数展示；Markdown 标题、列表、表格、代码块正常，HTML 按文本显示，原始回答保留。高作品在桌面约 1570px、390px 手机约 2270px，预置演示作品也按内容展开，无预览内部竖向滚动条。明暗结果页及手机配置弹窗没有横向溢出，关闭按钮和 Escape 正常；主页面、健康检查及新资源可访问，后端源码与测试返回 404。模拟数据不能证明真实供应商缓存命中或 Grok 流式兼容性；真实供应商生成和 Docker 构建未执行。

此前真实地址 `https://franklybuilds.com/v1/responses` 使用合成无效 Key 返回 HTTP 401，浏览器显示 `Invalid API key`，只证明当时本机后端能够到达该接口，未使用真实 Key 或验证模型生成，也不能证明本轮流式兼容性。正式测试时再填写自己的有效 Key 和供应商支持的 Model ID，检查连接、实际回答及真实 `usage`。本地通过不代表任意供应商实际兼容。

协议依据：[OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create)、[OpenAI 流式响应](https://developers.openai.com/api/docs/guides/streaming-responses)、[OpenAI 提示词缓存](https://developers.openai.com/api/docs/guides/prompt-caching)、[Claude Messages](https://platform.claude.com/docs/en/api/messages/create)、[Claude 流式响应](https://platform.claude.com/docs/en/build-with-claude/streaming)、[Claude 提示词缓存](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)。流式事件与用量合并规则已用 Context7 核对官方文档及 Anthropic 官方 SDK；真实供应商流式兼容性需要用户实测。
