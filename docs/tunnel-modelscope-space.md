# 方案：用魔搭创空间（免费 Space）做内网穿透

> 定位：`bore.pub` 的平替。bore 把本地端口映射成 `bore.pub:<port>`；
> 本方案把本地服务映射成 `https://<owner>-<space>.ms.show`（魔搭创空间的免费公网域名）。
> 适用于：把本地跑的 examgen 网页（`http://127.0.0.1:8787`）临时暴露给公网，方便演示/远程查看进度。
> 状态：中继 + 客户端已全链路自测通过（JSON / SSE 流式 / POST / 5MB 响应 / 并发 / 重连 / 双通道降级）。

---

## 1. 为什么不是 bore.pub，以及两者对照

bore.pub 的公共服务器在境外且随时可能限流/失效；魔搭创空间在国内、免费、给独立 HTTPS 域名。
但魔搭 Space 只暴露 **443 的 HTTP(S)**（应用须监听容器内 7860 端口，由平台反代），不支持任意 TCP 端口直连，
所以不能照搬 bore 的「原始 TCP 转发」，而是做 **HTTP 反向隧道**：公网访客请求 → 中继打包 → 常驻加密连接下发到本地 →
本地请求 `127.0.0.1:8787` → 响应流式回传。对网页访问（含 SSE 实时推送）而言体验与直连一致。

| | bore.pub | 魔搭 Space 方案（本方案） |
| --- | --- | --- |
| 中继来源 | 公共服务器（ekzhang/bore） | 自己部署的免费 Space（CPU 实例） |
| 公网地址 | `bore.pub:<port>` | `https://<owner>-<space>.ms.show` |
| 本地启动 | `bore local 8787 --to bore.pub` | `./tunnel/local/up.sh --remote https://xxx.ms.show --token S` |
| 转发协议 | 原始 TCP | HTTPS（WSS 首选，自动降级 SSE） |
| 鉴权 | 可选 server token | `TUNNEL_TOKEN`（客户端）+ 可选 `TUNNEL_VISITOR_TOKEN`（访客） |
| 成本/稳定性 | 免费/无 SLA | 免费/无 SLA，空闲可能休眠，需手动唤醒 |
| 限制 | 端口段、带宽 | 仅 HTTP(S) 流量；请求体默认 ≤8MB；速度受 Space 免费带宽限制 |

## 2. 架构与原理

```
 公网访客                魔搭创空间 (*.ms.show → 容器 :7860)              你的电脑
    │                        app.py（aiohttp 中继）                 tunnel-client.mjs      本地服务
    │  GET /api/state             │                                   (常驻外连)          :8787
    │ ──────────────────────────► │                                       │                  │
    │                             │ {"t":"req","id","m","p","h","b"}      │                  │
    │                             │ ──────────── WSS / SSE ─────────────► │                  │
    │                             │                                       │ GET /api/state   │
    │                             │                                       │ ────────────────►│
    │                             │ {"t":"res"…} {"t":"chunk"…} {"t":"end"}                  │
    │ ◄────────────────────────── │ ◄───────────────────────────────────── │ ◄────────────────│
```

- **下行通道**（中继 → 本地）二选一，客户端自动选择：
  - `WSS /__tunnel_ws`：单条 WebSocket，双向、低开销（首选）；
  - `SSE /__tunnel_sse` + `POST /__tunnel_up`：纯 HTTP，当平台反代不透传 `Upgrade` 时自动降级。
  本地客户端零依赖（Node 18+ 自带 fetch；WS 客户端帧为手写实现），无需 npm install。
- **上行路径**：中继把访客的 method/path/query/headers/body(base64) 打包成 JSON 消息；本地用 fetch 请求目标服务，
  响应**流式**分块回传（`res` → `chunk`×N → `end`），因此本地服务的 SSE 实时推送在公网端仍然逐事件实时。
- **控制路径不转发**：`/__tunnel_ws`、`/__tunnel_sse`、`/__tunnel_up`、`/__tunnel_status` 供隧道自用；其余任意路径全部转发。
- **未连接引导页**：隧道不在线时，任意路径返回 200 引导页（10s 自动刷新），既方便排错，也保证创空间构建健康检查通过。

## 3. 目录结构

```
tunnel/
├── README.md                 # 快速开始（3 步）
├── space/                    # 上传到魔搭创空间的三件套
│   ├── README.md             # 含创空间构建 YAML 元数据（sdk: gradio + app_file: app.py）
│   ├── app.py                # 中继服务端（aiohttp；监听 7860）
│   └── requirements.txt      # 仅 aiohttp
└── local/
    ├── tunnel-client.mjs     # 本地客户端（零依赖 Node 18+，WSS→SSE 自动降级，断线指数退避重连）
    ├── up.sh                 # 一键启动（可顺带拉起 node src/server.js）
    └── fake-local.mjs        # 自测用假本地服务（JSON/SSE/echo/big），日常使用不需要
```

## 4. 部署 Space（一次性，约 5 分钟）

1. 登录 [modelscope.cn](https://modelscope.cn)，右上角「创建创空间」：
   - 名称任取（如 `examgen-tunnel`），**SDK 选 Gradio**，可见性选 **公开**（私有 Space 的直连域名需登录态，本方案不适用）；
   - 创建后进入 Space 的「模型文件」页。
2. 上传 `tunnel/space/` 下的 3 个文件（README.md / app.py / requirements.txt），覆盖模板内容。
3. Space「设置 → 变量与机密」新增 **机密**：
   - `TUNNEL_TOKEN`：自编口令（如 `openssl rand -hex 16`），客户端接入时校验，**防止他人抢占隧道**；
   - 可选 `TUNNEL_VISITOR_TOKEN`：设置后公网访客须带 `?vk=口令`（或 Cookie `vk`）才可访问；
   - 可选 `TUNNEL_REQ_TIMEOUT`（默认 300 秒）、`TUNNEL_MAX_BODY_MB`（默认 8）。
4. 等 Space 自动重建完成（状态变绿）。打开直连域名应看到「🔌 隧道未连接」引导页 —— 这是正常态。
5. 记下公网域名：Space 页面「直接访问」按钮的地址，形如
   `https://<你的用户名>-<space名>.ms.show`（以页面显示为准）。

> 说明：`sdk: gradio` 只是让平台按「Python 入口 + 7860 端口」约定运行 `app.py`，并不真的使用 gradio。
> 若平台构建时校验 gradio 依赖，在 `requirements.txt` 追加一行 `gradio` 即可（镜像变大，不影响功能）。
> 若将来创建时提供 Docker SDK，也可用 `python:3.11-slim` + `pip install aiohttp` + `EXPOSE 7860` 的 Dockerfile 等价实现。

## 5. 本地使用

### 一键启动（推荐）

```bash
cd /workspace/examgen
./tunnel/local/up.sh --remote https://<owner>-<space>.ms.show --token <TUNNEL_TOKEN> --with-server
# --with-server：若 8787 未监听则自动 node src/server.js；已在跑则跳过
# 其他参数：--target http://127.0.0.1:8787  --transport auto|ws|sse  --reconnect <秒上限>
# 亦可完全用环境变量：TUNNEL_REMOTE / TUNNEL_TOKEN / TUNNEL_TARGET / TUNNEL_TRANSPORT
```

看到「已连接中继 …（WSS），本地目标 …」后，浏览器访问 `https://<owner>-<space>.ms.show/` 即为本地 examgen 网页，
`/api/**` 与 `/output/**` 全部可用，管线运行时网页上的 SSE 实时进度在公网端照常逐事件推送。

### 直接用客户端（不经过 up.sh）

```bash
node tunnel/local/tunnel-client.mjs --remote https://<owner>-<space>.ms.show --token <TUNNEL_TOKEN>
```

| 参数 | 环境变量 | 默认 | 说明 |
| --- | --- | --- | --- |
| `--remote` | `TUNNEL_REMOTE` | 必填 | Space 公网地址（http/https 均可，本地自测用 http） |
| `--token` | `TUNNEL_TOKEN` | 空 | 与 Space 机密 `TUNNEL_TOKEN` 一致 |
| `--target` | `TUNNEL_TARGET` | `http://127.0.0.1:8787` | 本地要暴露的服务 |
| `--transport` | `TUNNEL_TRANSPORT` | `auto` | `auto`=先 WSS，失败永久降级 SSE；也可强制指定 |
| `--reconnect` | `TUNNEL_RECONNECT` | `15` | 断线重连退避上限（秒），指数退避 1s 起 |

客户端日志：`TUNNEL_DEBUG=1` 输出每条消息与每个 chunk 的明细（排错用）。

### 常驻运行

```bash
# pm2
pm2 start tunnel/local/tunnel-client.mjs --name tunnel -- --remote https://xxx.ms.show --token S
# systemd（节选）
[Service]
WorkingDirectory=/workspace/examgen
Environment=TUNNEL_REMOTE=https://xxx.ms.show
Environment=TUNNEL_TOKEN=S
ExecStart=/usr/bin/node tunnel/local/tunnel-client.mjs
Restart=always
```

## 6. 隧道协议 v1（自建中继时可对照实现）

下行连接建立后，中继先发 `{"t":"hello","proto":"ws|sse"}`；每 20s 发 `{"t":"ping"}`，客户端须回 `{"t":"pong"}`
（15s 一次保活上行亦可）；90s 无任何上行消息则中继断开该连接。

访客请求 → 中继发给客户端：

```json
{"t":"req","id":"12位hex","m":"GET","p":"/api/state","q":"a=1",
 "h":{"accept":"*/*"},            // 已剔除 hop-by-hop 头与 host
 "b":"<请求体 base64，可空>"}      // 上限 TUNNEL_MAX_BODY_MB
```

客户端 → 中继（WS 帧或 POST /__tunnel_up）：

```json
{"t":"res","id":"…","s":200,"h":{"content-type":"…"},"b":"<首块 base64，可空>"}
{"t":"chunk","id":"…","b":"<base64>"}     // N 次
{"t":"end","id":"…","err":"仅失败时携带"}
```

同一连接只允许一个客户端（新连接顶替旧连接）；请求首包/空闲超时 `TUNNEL_REQ_TIMEOUT`（默认 300s），
流式响应一旦开始则以块间空闲超时为准，长 SSE 不受总时长限制。

## 7. 安全模型

- **Space 是公开的**：任何拿到 `*.ms.show` 域名的人都能访问你暴露的本地服务。
  兜底三层：① `TUNNEL_TOKEN` 防止隧道被抢；② `TUNNEL_VISITOR_TOKEN` 给访客加口令；
  ③ 本地服务自身鉴权（examgen 目前无登录态，公网演示时建议开启 ② 或用后即关）。
- 客户端到中继的 token 走 HTTPS/WSS 传输；不要把生产 API key 暴露在被穿透的服务上。

## 8. 已知限制

| 限制 | 说明 / 缓解 |
| --- | --- |
| 仅 HTTP(S) | 平台只反代 443 → 7860，不能转发 SSH/数据库等任意 TCP。需要任意 TCP 时仍用 bore/frp + 自有 VPS |
| 空闲休眠 | 免费 CPU Space 长时间无访问可能休眠；唤醒方式为在 Space 页面重启实例，或用外部定时任务每 5~10 分钟 `curl /__tunnel_status` 保活 |
| 请求体上限 | 默认 8MB（`TUNNEL_MAX_BODY_MB`），大文件上传不适用 |
| 带宽 | 免费 CPU 实例共享带宽，5MB 响应实测数秒级，不适合大流量 |
| 单隧道 | 一个 Space 同时只服务一个本地客户端（多客户端互相顶替）。需要多条隧道 → 再建一个 Space，或扩展 `app.py` 的 pending 表按 token 分隧道 |
| 多值响应头 | JSON 化 headers 时同名字头合并（如多个 `Set-Cookie`）；examgen 未使用，一般无影响 |
| 反代缓冲 | 平台层若对 SSE 做缓冲会引入延迟（`X-Accel-Buffering: no` 已由中继下发，实测 Gradio 系平台流式可用） |

## 9. 排错 FAQ

| 现象 | 原因 / 处理 |
| --- | --- |
| 访问域名始终是「隧道未连接」引导页 | 本地客户端没跑起来或 token 不符。看客户端输出：`sse connect failed: HTTP 401` = token 错；`websocket upgrade failed: HTTP 502` = Space 还在构建 |
| 客户端反复「连接断开 → 重连」 | 打开 `TUNNEL_DEBUG=1` 看最后一条消息；确认 Space 未在重建（重建会断连），确认 `TUNNEL_TOKEN` 与 Space 机密一致 |
| WSS 连不上但能访问页面 | 平台反代未透传 WebSocket Upgrade → 客户端会自动降级 SSE（日志可见「降级 SSE」），无需处理 |
| Space 构建失败 | 看 Space 构建日志：多为 requirements 解析失败或 7860 未监听；`app.py` 已监听 0.0.0.0:7860，检查文件是否完整上传 |
| 403 | 私有 Space 的直连域名需要登录态 → 请用公开 Space |
| 本地服务端口不同 | `--target http://127.0.0.1:<端口>` |

## 10. 自测（改动代码后回归）

`fake-local.mjs` 模拟本地服务（JSON API / SSE 3 事件 / POST 回显 / 5MB 响应 / 302 / 404），
用 `http://127.0.0.1:7860` 起中继即可全链路自测（无需魔搭账号）：

```bash
# 三个终端或加 & 后台：中继 → 假本地服务 → 客户端
TUNNEL_TOKEN=testtok python3 tunnel/space/app.py &
FAKE_PORT=9999 node tunnel/local/fake-local.mjs &
node tunnel/local/tunnel-client.mjs --remote http://127.0.0.1:7860 --token testtok --target http://127.0.0.1:9999
# 然后访问 http://127.0.0.1:7860/api/state、/sse、POST /echo …（即走完整隧道链路）
```

本轮回归覆盖并通过（61 项断言）：WS 通道与 SSE 降级通道接入、JSON API、请求头透传与 Host 重写、
SSE 流式透传（首事件延迟 ≈ 本地定时器间隔，证明逐事件实时）、访客中途断开后隧道存活、
POST 100KB 回显一致、5MB 流式响应完整、302/404 原样透传、10 并发、错误 token 401、
新客户端顶替旧连接、顶替者退出后自动重连恢复。
