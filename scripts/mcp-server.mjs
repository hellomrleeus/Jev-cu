#!/usr/bin/env node
/**
 * Jev-cu Model Context Protocol (MCP) Server
 *
 * 为 Antigravity 提供原生工具支持：
 * - jev_list_apps: 获取当前运行的可控 App 列表
 * - jev_observe: 获取指定 App 的 AX 状态树及候选元素
 * - jev_action: 对指定元素执行点击/输入/按键动作
 * - jev_run_task: 运行完整的 Jev-cu 自动化循环
 */
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMacDriver } from "./driver/mac-driver.mjs";
import { parseAX, selectCandidates, runTask } from "./loop.mjs";
import { decide as jevDecide } from "./jev-decide.mjs";
import { decide as antigravityDecide } from "./antigravity-decide.mjs";

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const driver = createMacDriver();

process.on("exit", () => {
  driver.close?.();
});

const TOOLS = [
  {
    name: "jev_list_apps",
    description: "获取当前 macOS 系统中正在运行的可进行 GUI 辅助功能控制的应用列表。",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "jev_observe",
    description: "读取指定 macOS 应用的 Accessibility (AX) 语义树，并根据可选的 goal 过滤出候选可交互控件。",
    inputSchema: {
      type: "object",
      properties: {
        appName: {
          type: "string",
          description: "目标应用名称，如 'Calendar'、'Calculator'、'TextEdit'、'计算器'、'日历'",
        },
        goal: {
          type: "string",
          description: "当前目标描述（可选），用于对候选控件打分与排序",
        },
        maxCandidates: {
          type: "number",
          description: "返回候选控件的最大数量，默认为 30",
        },
      },
      required: ["appName"],
    },
  },
  {
    name: "jev_action",
    description: "在指定应用上执行低级别 GUI 动作（如点击控件、输入文本、按键、滚动）。",
    inputSchema: {
      type: "object",
      properties: {
        appName: {
          type: "string",
          description: "目标应用名称",
        },
        action: {
          type: "string",
          enum: ["click_element", "set_value", "type_text", "press_key", "scroll"],
          description: "执行的动作类型",
        },
        targetIndex: {
          type: "number",
          description: "目标元素的 index（来自 jev_observe 的索引）",
        },
        text: {
          type: "string",
          description: "输入或设置的文本内容（适用于 set_value / type_text）",
        },
        key: {
          type: "string",
          description: "按下的按键名称（适用于 press_key，如 'Return', 'Escape', 'Tab', 'Up', 'Down' 等）",
        },
        direction: {
          type: "string",
          enum: ["up", "down", "left", "right"],
          description: "滚动方向（适用于 scroll）",
        },
      },
      required: ["appName", "action"],
    },
  },
  {
    name: "jev_run_task",
    description: "运行去视觉化的 Jev-cu 自动化闭环（观测 -> 候选抽取 -> Jev决策 -> Policy门槛 -> 执行）。",
    inputSchema: {
      type: "object",
      properties: {
        appName: {
          type: "string",
          description: "目标应用名称（如 Calendar, Calculator）",
        },
        goal: {
          type: "string",
          description: "执行目标（建议使用英文）",
        },
        dryRun: {
          type: "boolean",
          description: "是否仅进行预览而不实际执行动作。默认为 true，需安全确认后传 false",
        },
        maxSteps: {
          type: "number",
          description: "最大步骤数，默认为 10",
        },
        engine: {
          type: "string",
          enum: ["auto", "jev", "antigravity"],
          description: "决策引擎：'auto' (自动选择), 'jev' (TypeSafe API), 'antigravity' (Agent/LLM模型)",
        },
        verifyText: {
          type: "string",
          description: "完成校验文本：当 AX 树中包含此文本时直接判定成功完成",
        },
        mock: {
          type: "boolean",
          description: "是否使用本地启发式 Mock 决策（无需 API Key）",
        },
      },
      required: ["appName", "goal"],
    },
  },
  {
    name: "jev_decide",
    description: "对给定的候选控件列表进行结构化决策，选出下一步点击目标与动作。",
    inputSchema: {
      type: "object",
      properties: {
        appName: {
          type: "string",
          description: "目标应用名称",
        },
        goal: {
          type: "string",
          description: "任务目标",
        },
        candidates: {
          type: "array",
          description: "候选控件列表 (来自 jev_observe)",
        },
        context: {
          type: "string",
          description: "当前 UI 上下文（如窗口标题、关键显示值）",
        },
        engine: {
          type: "string",
          enum: ["auto", "jev", "antigravity"],
          description: "决策引擎，默认为 auto",
        },
      },
      required: ["appName", "goal", "candidates"],
    },
  },
];

async function handleToolCall(name, params) {
  switch (name) {
    case "jev_list_apps": {
      const apps = await driver.listApps();
      return { apps };
    }

    case "jev_observe": {
      await driver.bind(params.appName);
      const axText = await driver.observe({ full: true });
      const elements = parseAX(axText);
      const candidates = selectCandidates(elements, params.goal || "", { max: params.maxCandidates || 30 });
      return {
        appName: params.appName,
        totalElements: elements.length,
        candidateCount: candidates.length,
        candidates: candidates.map((c) => ({
          index: c.index,
          role: c.role,
          label: c.label,
          score: c.score,
        })),
        rawAXSnippet: axText.split("\n").slice(0, 50).join("\n"),
      };
    }

    case "jev_action": {
      await driver.bind(params.appName);
      switch (params.action) {
        case "click_element":
          if (params.targetIndex == null) throw new Error("Missing targetIndex for click_element");
          await driver.click(params.targetIndex);
          break;
        case "set_value":
          if (params.targetIndex == null) throw new Error("Missing targetIndex for set_value");
          await driver.setValue(params.targetIndex, params.text ?? "");
          break;
        case "type_text":
          await driver.typeText(params.text ?? "");
          break;
        case "press_key":
          await driver.pressKey(params.key ?? "Return");
          break;
        case "scroll":
          await driver.scroll(params.targetIndex, params.direction ?? "down", 1);
          break;
        default:
          throw new Error(`Unsupported action: ${params.action}`);
      }
      return { ok: true, action: params.action, targetIndex: params.targetIndex };
    }

    case "jev_decide": {
      const engine = params.engine || "auto";
      const decideFn = engine === "jev" ? jevDecide : antigravityDecide;
      const decision = await decideFn({
        goal: params.goal,
        app: params.appName,
        candidates: params.candidates || [],
        context: params.context || "",
      });
      return decision;
    }

    case "jev_run_task": {
      let decideFn = undefined;
      let engine = params.engine || "auto";
      if (params.mock) {
        engine = "antigravity";
      }

      const logs = [];
      const verify = params.verifyText
        ? (axText) => axText.toLowerCase().includes(params.verifyText.toLowerCase())
        : undefined;

      const result = await runTask({
        driver,
        appName: params.appName,
        goal: params.goal,
        engine,
        dryRun: params.dryRun ?? true,
        maxSteps: params.maxSteps ?? 10,
        decide: decideFn,
        verify,
        emit: (line) => logs.push(line),
      });

      return {
        ...result,
        logs,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on("line", async (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch (err) {
    sendResponse({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
    return;
  }

  const { id, method, params } = request;

  try {
    if (method === "initialize") {
      sendResponse({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: {
            name: "jev-cu",
            version: "0.2.0",
          },
        },
      });
    } else if (method === "notifications/initialized") {
      // no response required
    } else if (method === "tools/list") {
      sendResponse({
        jsonrpc: "2.0",
        id,
        result: { tools: TOOLS },
      });
    } else if (method === "tools/call") {
      const toolName = params?.name;
      const toolArgs = params?.arguments ?? {};
      const resultData = await handleToolCall(toolName, toolArgs);
      sendResponse({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(resultData, null, 2),
            },
          ],
        },
      });
    } else if (method === "ping") {
      sendResponse({ jsonrpc: "2.0", id, result: {} });
    } else {
      sendResponse({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    }
  } catch (err) {
    sendResponse({
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message: err.message },
    });
  }
});

function sendResponse(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}
