#!/usr/bin/env node
/**
 * Jev-cu CLI 运行器（支持在 Antigravity 中直接运行或脚本调用）
 *
 * 示例：
 *   node scripts/run.mjs --app Calculator --goal "clear all" --dry-run
 *   node scripts/run.mjs --app Calendar --goal "switch to previous month" --execute
 *   node scripts/run.mjs --app Calculator --goal "press 7" --mock --execute
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTask } from "./loop.mjs";
import { decide as jevDecide, loadApiKey } from "./jev-decide.mjs";
import { createMacDriver } from "./driver/mac-driver.mjs";

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    appName: "Calculator",
    goal: "",
    engine: "auto", // "auto" | "jev" | "antigravity"
    dryRun: true,
    maxSteps: 10,
    candidateMax: 40,
    mock: false,
    json: false,
    verifyText: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--app" && i + 1 < args.length) options.appName = args[++i];
    else if (arg === "--goal" && i + 1 < args.length) options.goal = args[++i];
    else if (arg === "--engine" && i + 1 < args.length) options.engine = args[++i];
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--execute" || arg === "--no-dry-run") options.dryRun = false;
    else if (arg === "--max-steps" && i + 1 < args.length) options.maxSteps = Number(args[++i]);
    else if (arg === "--candidate-max" && i + 1 < args.length) options.candidateMax = Number(args[++i]);
    else if (arg === "--verify" && i + 1 < args.length) options.verifyText = args[++i];
    else if (arg === "--mock") options.mock = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
  }
  return options;
}

function printHelp() {
  console.log(`
Jev-cu CLI - 去视觉化轻量级 Computer Use

用法:
  node scripts/run.mjs [选项]

选项:
  --app <name>           目标应用名称 (如: Calculator, Calendar, TextEdit)
  --goal <text>          执行目标 (建议英文以获取最佳决策准确率)
  --engine <engine>      决策引擎: auto (自动检测) | jev (TypeSafe API) | antigravity (Agent/LLM模型)
  --dry-run              预览下一步决策，不执行动作 (默认)
  --execute              真实执行动作
  --max-steps <num>      最大步骤数 (默认: 10)
  --candidate-max <num>  候选控件上限 (默认: 40)
  --verify <text>        成功判据：UI 状态包含指定文本时判定完成
  --mock                 使用本地启发式决策 (无需任何 API Key，用于离线调试)
  --json                 以 JSON 格式输出最终结果
  -h, --help             显示帮助信息
  `);
}

async function main() {
  const options = parseArgs();

  if (!options.goal) {
    console.error("错误：请提供 --goal 参数。例如：--goal \"switch to previous month\"");
    process.exit(1);
  }

  // 决策引擎处理
  let decideFn = undefined;
  if (options.mock) {
    options.engine = "antigravity";
  }

  const driver = createMacDriver();
  const verify = options.verifyText
    ? (axText) => axText.toLowerCase().includes(options.verifyText.toLowerCase())
    : undefined;

  const emit = options.json
    ? () => {}
    : (line) => console.log(line);

  try {
    const result = await runTask({
      driver,
      appName: options.appName,
      goal: options.goal,
      engine: options.engine,
      dryRun: options.dryRun,
      maxSteps: options.maxSteps,
      candidateMax: options.candidateMax,
      decide: decideFn,
      verify,
      emit,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("\n================ 运行结果 ================");
      console.log(`状态:   ${result.status}`);
      console.log(`耗时:   ${(result.elapsedMs / 1000).toFixed(2)}s`);
      if (result.planned) {
        console.log(`计划动作: ${result.planned.action} -> i${result.planned.targetIndex} (${result.planned.targetLabel})`);
      }
      if (result.message) {
        console.log(`消息:   ${result.message}`);
      }
      console.log(`轨迹日志: ${result.tracePath}`);
      console.log("==========================================\n");
    }

    process.exit(result.status === "error" ? 1 : 0);
  } catch (err) {
    console.error(`[run] 执行异常：${err.message}`);
    process.exit(1);
  } finally {
    await driver.close();
  }
}

main();
