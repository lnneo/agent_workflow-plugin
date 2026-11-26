# Agent Workflow Plugin (v2)

Plugin giúp bạn làm việc với AI Agent bài bản theo quy trình **2 bước (`/spec` rồi mới `/build`)**, tránh tình trạng AI tự ý sửa code khi chưa thống nhất phạm vi.

Plugin hỗ trợ sẵn **Multi-Workspace** qua file `.ai/workspace.md`, tự đồng bộ nhánh Git lên MCP (`/handoff-sync` không cần mount code vào Docker), đi kèm **HTTP MCP Server** (`pg`, `redis`, `handoff`, `backlog`) và trang **Task Cockpit (`/viewer`)** để theo dõi tiến độ trực quan.

---

## 1. Quy trình làm việc chính

| Lệnh | Mục đích | Cách hoạt động |
| :--- | :--- | :--- |
| `/init` | Thiết lập lần đầu | Hỏi đáp nhanh để tạo `.ai/workspace.md` (khai báo các repo `FE`/`BE`/`Infra`, thứ tự deploy, lệnh test/Playwright) và sync lịch sử Git nếu muốn. |
| `/spec` | **Bước 1: Chốt kế hoạch** *(chỉ đọc, không sửa code)* | Chạy được trên mọi branch. AI đọc code liên quan, trao đổi làm rõ yêu cầu, soạn Proposal + Tech Spec và lưu **Executable Spec** vào `handoff` MCP. |
| `/build` | **Bước 2: Tự động triển khai** | Chỉ chạy trên working branch (`feature/*`, `fix/*`, `refactor/*`, `chore/*`). AI tự lên plan, code theo TDD, chạy test/Playwright, tự review rồi commit và lưu handoff snapshot. |
| `/handoff-sync` | Đồng bộ Git | Quét toàn bộ branch và commit trên máy qua `git`, gửi một lần lên `handoff` MCP để theo dõi trên `/viewer`. |

### Các thành phần đi kèm
- **Hook `SessionStart`** ([`hooks/session-start.sh`](hooks/session-start.sh)): Tự chạy khi mở phiên mới trên cả **Antigravity** và **Claude Code**:
  - Nhắc chạy `/init` nếu workspace chưa có `.ai/workspace.md`.
  - Cảnh báo nếu bạn đang đứng trên protected branch (`main`, `master`, `staging`, `develop`).
  - Nhắc lưu handoff snapshot khi kết thúc task trên working branch.
- **Rules & Skills**: Bộ quy tắc chung tại [`rules/AGENTS.md`](rules/AGENTS.md), 33 skills chuyên sâu theo từng công đoạn trong `skills/` và bộ checklist chuẩn trong `references/`.
- **Unified HTTP MCP Server** (`tools/mcp`): Chạy bằng Docker, cung cấp sẵn 4 endpoint (`pg`, `redis`, `handoff`, `backlog`), lưu dữ liệu bằng SQLite và có dashboard `/viewer`.

---

## 2. Hướng dẫn Setup

### Bước 1: Chạy HTTP MCP Server (Docker)

Chuyển vào thư mục `tools/mcp` và tạo file cấu hình `.env`:

```bash
cd tools/mcp
cp -n .env.example .env
```

Mở file `tools/mcp/.env` và điền thông tin môi trường của bạn:
- `PORT=3030` *(mặc định `3030`; nếu máy bạn trùng cổng và đổi sang số khác, nhớ sửa lại port tương ứng trong `mcp_config.json` / `.mcp.json` hoặc config MCP cá nhân của IDE)*.
- `PG_URL`, `REDIS_URL` và các cờ `MCP_*_ENABLED`.
- Nếu bật `MCP_BACKLOG_ENABLED=true`, điền thêm `BACKLOG_DOMAIN` và `BACKLOG_API_KEY`.

Sau đó dựng và chạy container:

```bash
docker compose up -d --build
```

Khi container chạy thành công, các endpoint mặc định (port `3030`) gồm:
- `GET  http://localhost:3030/health` — Kiểm tra tình trạng các module (`pg`, `redis`, `handoff`, `backlog`)
- `GET  http://localhost:3030/viewer` — **Handoff MCP Cockpit** (thanh tiến độ 5 bước, Spec/Build, lịch sử Commit/Deploy, Live Monitor và bảng SQLite)
- `HTTP http://localhost:3030/pg` — PostgreSQL MCP
- `HTTP http://localhost:3030/redis` — Redis MCP
- `HTTP http://localhost:3030/handoff` — Lưu Spec, kết quả test, Handoff Snapshot và Sync Git
- `HTTP http://localhost:3030/backlog` — Backlog MCP *(khi bật `MCP_BACKLOG_ENABLED=true`)*

---

### Bước 2: Cài đặt Plugin vào IDE / CLI

#### Với Antigravity
Clone repo này trực tiếp vào thư mục plugin của Antigravity (dùng cơ chế plugin native, không cần tạo symlink):

```bash
git clone -b develop https://github.com/lnneo/agent_workflow-plugin.git ~/.gemini/config/plugins/agent-workflow-plugin
```
*(Nếu chỉ muốn dùng riêng cho một dự án, bạn có thể clone vào `.agents/plugins/agent-workflow-plugin` trong thư mục dự án đó.)*

Khi muốn kéo bản cập nhật mới nhất:

```bash
git -C ~/.gemini/config/plugins/agent-workflow-plugin pull origin develop
```

#### Với Claude Code / Claude CLI
Cài nhanh ngay trong khung chat Claude Code (phiên bản `2.1.275+`):

```text
/plugin install agent-workflow-plugin --marketplace lnneo/agent_workflow-plugin
```

Hoặc cài qua terminal bằng `claude` CLI:

```bash
claude plugin marketplace add lnneo/agent_workflow-plugin
claude plugin install agent-workflow-plugin
```

Khi có cập nhật mới cho plugin:

```bash
claude plugin marketplace update agent-workflow-marketplace
claude plugin install agent-workflow-plugin@agent-workflow-marketplace
```

---

### Bước 3: Bắt đầu với một dự án mới

1. Mở project trong Antigravity hoặc Claude Code — nếu chưa có `.ai/workspace.md`, hook sẽ tự động nhắc bạn ở đầu phiên.
2. Gõ `/init` để khai báo nhanh các repo (`FE`/`BE`/`Infra`), lệnh test/Playwright và đồng bộ nhánh Git ban đầu.
3. Khi làm tính năng hoặc sửa bug mới: chạy `/spec <mô tả>` để thống nhất thiết kế → chuyển sang nhánh working branch → chạy `/build` để AI hoàn thiện và lưu handoff.

---

## 3. Cấu trúc thư mục chính

```text
agent-workflow-plugin/
├── plugin.json                  # Khai báo plugin cho Antigravity
├── mcp_config.json              # Cấu hình HTTP MCP cho Antigravity
├── .mcp.json                    # Cấu hình HTTP MCP cho Claude Code
├── .claude-plugin/              # Marketplace & manifest cho Claude CLI
├── hooks.json & hooks/          # Hook SessionStart dùng chung cho Antigravity & Claude
├── rules/AGENTS.md              # Bộ quy tắc kỹ thuật chung
├── commands/                    # Lệnh /init, /spec, /build, /handoff-sync
├── skills/                      # 33 skills chi tiết theo từng giai đoạn phát triển
├── references/                  # Các checklist chuẩn & Definition of Done
├── sync-from-agent-skills.sh    # Script đồng bộ skills & references từ upstream
└── tools/mcp/                   # Mã nguồn Unified HTTP MCP Server & /viewer Cockpit
```
