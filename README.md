# Jev-cu

把 Computer Use 的「下一步点哪里」交给 Jev（TypeSafe System One）：Jev 从界面文字候选中选元素、动作、完成度与风险，本地 macOS 辅助功能驱动（Accessibility Tree, AX）负责读取界面与模拟执行，本地策略门槛拦截敏感操作。只传文字，不传截图。

已全面支持在 **Antigravity** 中开箱即用！

## 目录结构

```
native/          macOS 原生辅助功能驱动源码（Swift 6.4，毫秒级读取与事件触发）
bin/             编译生成的本地原生驱动 mac-ax
skill/jev-cu/    Antigravity 技能定义（SKILL.md）
scripts/
  ├── build-native.mjs   原生 Swift 驱动编译脚本
  ├── run.mjs            统一命令行执行器（CLI）
  ├── mcp-server.mjs     Model Context Protocol (MCP) 服务器
  ├── loop.mjs           主循环引擎
  ├── driver/            macOS 原生驱动适配层
  ├── jev-decide.mjs     TypeSafe System One 决策调用
  ├── policy.mjs         本地安全门槛与 App 白名单
  └── install-skill.mjs  Antigravity 技能安装器
fixtures/        AX 快照与评测用例
tests/           单测集
```

## 快速上手

### 1. 编译原生驱动

系统需要 macOS（已内置 Swift 编译器 `swiftc`）：

```bash
npm run build
```

> **注意**：运行本驱动需要 macOS **辅助功能权限（Accessibility）**。
> 运行 `./bin/mac-ax is-trusted`，输出 `true` 即表示权限已具备。

### 2. 双决策引擎配置

- **Jev 引擎**（基于 TypeSafe System One）：
  需在 `.env.local` 写入 key：
  ```bash
  echo 'TYPESAFE_API_KEY=<your key>' > .env.local
  ```
- **Antigravity 引擎**（面向 Antigravity 用户，**无需 TYPESAFE_API_KEY**）：
  - 若配置了 `GEMINI_API_KEY` 或 `OPENAI_API_KEY`，可调用对应大语言模型；
  - **若无任何 API Key**，内置的高精度离线智能语义引擎将自动接管，100% 离线可用！

### 3. 安装 Antigravity Skill

```bash
npm run install-skill          # 安装到当前项目 .agents/skills/jev-cu（新会话自动生效）
npm run install-skill --global # 安装到全局 ~/.gemini/config/skills/jev-cu
```

---

## 在 Antigravity 中使用

### 方式 A：命令行运行（CLI）

可以直接在终端中执行任务（默认 `--engine auto`，未配置 key 时自动使用 `antigravity` 引擎）：

```bash
# 1. 自动选择引擎，预览（Dry-Run）
node scripts/run.mjs --app Calculator --goal "clear all" --dry-run

# 2. 显式指定 Antigravity 模型引擎并真实执行
node scripts/run.mjs --app Calculator --goal "press 7" --engine antigravity --execute --max-steps 1

# 3. 显式指定 Jev 引擎（需 TYPESAFE_API_KEY）
node scripts/run.mjs --app Calculator --goal "press 7" --engine jev --execute --max-steps 1
```

### 方式 B：MCP Server（Model Context Protocol）

项目内置了标准的 MCP 服务器：
- `jev_list_apps`：获取当前可控 App 列表
- `jev_observe`：读取应用 AX 树并抽取候选元素
- `jev_action`：单步执行点击、输入、按键或滚动
- `jev_run_task`：一键自动执行完整闭环

在 Antigravity 的 `mcp_config.json` 中配置即可：

```json
{
  "mcpServers": {
    "jev-cu": {
      "command": "node",
      "args": ["/绝对路径/scripts/mcp-server.mjs"]
    }
  }
}
```

---

## 验证与测试

```bash
npm test        # 运行全部单测（包括 AX 解析、Policy、原生驱动生命周期）
npm run p0      # 离线评测：AX 快照选元素准确率（调用 Jev，需配置 KEY）
```

## 安全边界

- **默认 dry-run**：删除、发送、支付、授权、上传、验证码、安装、系统设置等操作停在 `confirm`，需人工确认。
- **App 白名单**：定义在 `scripts/policy.mjs`，已内置 Calculator/计算器、Calendar/日历、TextEdit/文本编辑 等低风险应用。
- **界面文字纯数据**：不将界面文字当作指令解析；不绕过登录、付费墙和验证码。
