---
name: jev-cu
description: 使用 Jev（TypeSafe System One）结合 macOS Accessibility (AX) 辅助功能树，进行去视觉化（No-Vision）的轻量级 GUI 自动化操作。适用于日历、计算器、文本编辑等原生应用的无截图精准操作与对照实验。
---

# Jev-cu: 去视觉化轻量级 Computer Use

Jev-cu 采用纯文本/结构化驱动的 macOS GUI 自动化方案：
1. **放弃截图**：通过 macOS 辅助功能树（Accessibility Tree, AX）毫秒级提取界面语义树，不抓取屏幕像素，保护隐私且速度极快；
2. **双决策引擎**：
   - **`jev` 引擎**：极速选择题决策（TypeSafe System One），需配置 `TYPESAFE_API_KEY`；
   - **`antigravity` 引擎**：**无需 `TYPESAFE_API_KEY`**，支持 Antigravity Agent 自身模型、Gemini / OpenAI API 或离线智能语义匹配；
3. **本地安全门槛（Policy Gate）**：白名单限制 + 敏感操作（删除、支付、授权、安装等）本地硬编码拦截；
4. **原生驱动执行**：通过本地 Swift 原生驱动模拟真实的 AXPress 与鼠标/键盘交互。

## 触发条件与适用范围

- 当用户需要对 macOS 原生应用（如日历 Calendar、计算器 Calculator、文本编辑 TextEdit 等）执行精确 GUI 操作时；
- 当需要避免视觉截图的高 Token 消耗、高延迟、隐私泄露或坐标偏移时；
- 当进行 Computer Use 对照实验或无视觉自动化评测时。

> [!NOTE]
> 画布排版、三维建模及纯视觉图像设计不适合本方案。

---

## 运行方式

### 方式 1：通过 CLI 执行（推荐）

在 Antigravity 终端中通过 `run_command` 执行：

```bash
# 1. 自动选择引擎（未配置 TYPESAFE_API_KEY 时自动使用 antigravity 模型引擎）
node {{REPO_DIR}}/scripts/run.mjs --app Calculator --goal "clear all" --dry-run

# 2. 显式指定使用 Antigravity 模型引擎
node {{REPO_DIR}}/scripts/run.mjs --app Calculator --goal "press 7" --engine antigravity --execute --max-steps 1

# 3. 显式指定使用 Jev 引擎（需已配置 TYPESAFE_API_KEY）
node {{REPO_DIR}}/scripts/run.mjs --app Calendar --goal "switch the calendar to the previous month" --engine jev --execute

# 4. 带成功判据的自动化流程
node {{REPO_DIR}}/scripts/run.mjs --app Calendar --goal "switch the calendar to the previous month" --execute --verify "August"
```

**参数说明**：
- `--app <name>`: 目标应用名（如 `Calculator`, `计算器`, `Calendar`, `日历`, `TextEdit`）。
- `--goal <text>`: 目标描述（英文最佳，模型决策准确度最高）。
- `--engine <auto|jev|antigravity>`: 决策引擎选择（默认 `auto`）。
- `--dry-run`: 仅生成决策预览，不触发物理点击（默认）。
- `--execute`: 真实执行物理点击与输入。
- `--verify <text>`: 结果核验文本，界面出现该文本时立即成功结束。

---

### 方式 2：通过 MCP Server 工具调用

若项目配置了 MCP Server，Antigravity 可直接调用以下工具：
- `jev_list_apps`: 列出当前系统可控应用；
- `jev_observe`: 查看指定 App 当前的 AX 树与候选控件列表；
- `jev_decide`: 对候选控件发起单步决策（支持 `engine: "antigravity"` 或 `"jev"`）；
- `jev_action`: 单步执行 `click_element` / `type_text` / `press_key` / `set_value`；
- `jev_run_task`: 启动完整自动化闭环（支持指定 `engine`）。

---

## 配置与安全

1. **密钥配置**：
   在项目根目录 `.env.local` 写入：
   ```bash
   TYPESAFE_API_KEY=your_key_here
   ```
2. **系统权限**：
   macOS 辅助功能权限必须处于开启状态（`bin/mac-ax is-trusted` 输出 `true`）。
3. **安全边界**：
   - 默认必须先 dry-run；
   - 涉及删除、支付、发送、授权的敏感控件会被本地 Policy 拦截，返回 `confirm`，提示人工介入；
   - 连续两次相同动作且界面无变化时会自动中止。
