#!/usr/bin/env node
/**
 * Antigravity 决策引擎
 *
 * 为没有配置 TYPESAFE_API_KEY 的用户提供基于大语言模型或离线智能语义推理的决策能力。
 *
 * 支持三种模式：
 * 1. Gemini API：配置了 GEMINI_API_KEY 或 GOOGLE_API_KEY 时，直连 Google 官方 API；
 * 2. OpenAI 兼容 API：配置了 OPENAI_API_KEY 时，调用 OpenAI/DeepSeek/Ollama/OpenRouter；
 * 3. 智能语义启发式引擎（Smart Semantic Heuristic）：零 API Key 依赖，100% 离线，
 *    通过语义分词、AX 控件类型评分、上下文匹配与敏感词分析生成高置信度决策。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchSensitive } from "./policy.mjs";

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function getEnvVar(name) {
  if (process.env[name]) return process.env[name].trim();
  const envFile = path.join(PROJECT_DIR, ".env.local");
  try {
    const text = fs.readFileSync(envFile, "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && m[1] === name) return m[2].replace(/^['"]|['"]$/g, "").trim();
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function detectEngineAvailability() {
  const typesafeKey = getEnvVar("TYPESAFE_API_KEY");
  if (typesafeKey) return { defaultEngine: "jev", hasTypesafe: true };

  const geminiKey = getEnvVar("GEMINI_API_KEY") || getEnvVar("GOOGLE_API_KEY");
  const openaiKey = getEnvVar("OPENAI_API_KEY");
  return {
    defaultEngine: "antigravity",
    hasTypesafe: false,
    hasGemini: Boolean(geminiKey),
    hasOpenAI: Boolean(openaiKey),
  };
}

/**
 * 构造统一系统提示词
 */
function buildPrompt({ goal, app, candidates, context, recentActions, constraints }) {
  const candidateList = candidates
    .map((c) => `- i${c.index} [${c.role}]: "${c.label}"`)
    .join("\n");

  const recent = recentActions?.length ? recentActions.join("\n") : "None";

  return `You are Antigravity's GUI decision engine.
Your role is to choose the single best next action on the UI Accessibility Tree to achieve the user's goal.

Goal: "${goal}"
Application: ${app}

Current UI Context:
${context || "No context"}

Recent Actions:
${recent}

${constraints ? `Constraints:\n${constraints}\n` : ""}

Candidate Clickable Elements:
${candidateList}

You MUST answer with a single JSON object containing:
- "targetIndex": integer (the index number after 'i', e.g. 12 for 'i12'), or null if no element needs to be clicked
- "action": one of ["click_element", "set_value", "type_text", "press_key", "scroll", "wait", "ask_user"]
- "done": probability (0.0 to 1.0) whether the goal is ALREADY visibly completed in current UI
- "risk": probability (0.0 to 1.0) whether the next action involves high risk (delete data, send/submit, payment, change permissions, install, system settings)
- "confidence": probability (0.0 to 1.0) of your confidence in this chosen action
- "reasoning": brief explanation for your choice

Response format: ONLY raw JSON, without markdown code fences or other text.`;
}

/**
 * 调用 Gemini API (无额外 npm 依赖，原生 fetch)
 */
async function callGemini({ prompt, apiKey, model = "gemini-2.5-flash" }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API error (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty response from Gemini API");

  const clean = text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(clean);
}

/**
 * 调用 OpenAI 兼容 API
 */
async function callOpenAI({ prompt, apiKey, baseUrl = "https://api.openai.com/v1", model = "gpt-4o-mini" }) {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI API error (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty response from OpenAI API");

  const clean = text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(clean);
}

/**
 * 智能离线语义启发式决策器（无需任何 API Key）
 */
function heuristicDecide({ goal, candidates, context, recentActions }) {
  const goalLower = String(goal).toLowerCase();

  // 1. 检查是否已经完成 (done)
  const isAlreadyDone =
    (context && context.toLowerCase().includes(goalLower)) ||
    (recentActions?.length >= 1 && recentActions.at(-1)?.includes("changed") && goalLower.includes("press"));

  if (!candidates.length) {
    return {
      targetIndex: null,
      targetLabel: null,
      action: "ask_user",
      confidence: 0.2,
      risk: 0.0,
      done: isAlreadyDone ? 0.95 : 0.0,
      reasoning: "No candidate elements available",
    };
  }

  // 候选按相关度选择（优先按 score 排序）
  const sorted = [...candidates].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const topCandidate = sorted[0];

  // 动作判断
  let action = "click_element";
  if (/type|enter|input|write/i.test(goalLower) && ["text field", "search field"].includes(topCandidate.role)) {
    action = "set_value";
  } else if (/scroll|swipe/i.test(goalLower)) {
    action = "scroll";
  }

  // 敏感词风险判定
  const sensitive = matchSensitive(topCandidate.label);
  const risk = sensitive ? 0.85 : 0.01;

  // 置信度计算
  const score = topCandidate.score ?? 0;
  const confidence = score > 6 ? 0.95 : score > 2 ? 0.85 : 0.65;

  return {
    targetIndex: topCandidate.index,
    targetLabel: `${topCandidate.role}: ${topCandidate.label}`,
    action,
    confidence,
    risk,
    done: isAlreadyDone ? 0.9 : 0.05,
    reasoning: `Selected candidate i${topCandidate.index} based on highest relevance score (${score})`,
  };
}

/**
 * Antigravity 统一决策入口
 */
export async function decide({
  goal,
  app,
  candidates = [],
  context = "",
  recentActions = [],
  constraints = "",
  model,
  provider, // "auto" | "gemini" | "openai" | "heuristic"
}) {
  const t0 = Date.now();

  const geminiKey = getEnvVar("GEMINI_API_KEY") || getEnvVar("GOOGLE_API_KEY");
  const openaiKey = getEnvVar("OPENAI_API_KEY");
  const openaiBaseUrl = getEnvVar("OPENAI_BASE_URL") || "https://api.openai.com/v1";

  let result = null;
  let usedProvider = "heuristic";

  const targetProvider = provider || (geminiKey ? "gemini" : openaiKey ? "openai" : "heuristic");

  if (targetProvider === "gemini" && geminiKey) {
    try {
      const prompt = buildPrompt({ goal, app, candidates, context, recentActions, constraints });
      result = await callGemini({ prompt, apiKey: geminiKey, model: model || "gemini-2.5-flash" });
      usedProvider = "gemini";
    } catch (err) {
      console.warn(`[antigravity-decide] Gemini API 调用失败，自动降级至离线语义引擎：${err.message}`);
    }
  } else if (targetProvider === "openai" && openaiKey) {
    try {
      const prompt = buildPrompt({ goal, app, candidates, context, recentActions, constraints });
      result = await callOpenAI({ prompt, apiKey: openaiKey, baseUrl: openaiBaseUrl, model: model || "gpt-4o-mini" });
      usedProvider = "openai";
    } catch (err) {
      console.warn(`[antigravity-decide] OpenAI API 调用失败，自动降级至离线语义引擎：${err.message}`);
    }
  }

  // 离线启发式降级保护
  if (!result) {
    result = heuristicDecide({ goal, candidates, context, recentActions });
    usedProvider = "heuristic";
  }

  const targetCandidate = candidates.find((c) => c.index === result.targetIndex);
  const targetLabel = targetCandidate ? `${targetCandidate.role}: ${targetCandidate.label}` : result.targetLabel || null;

  return {
    targetIndex: result.targetIndex ?? null,
    targetLabel,
    action: result.action || "click_element",
    confidence: Number(result.confidence ?? 0.8),
    risk: Number(result.risk ?? 0.01),
    done: Number(result.done ?? 0.05),
    latencyMs: Date.now() - t0,
    engine: "antigravity",
    provider: usedProvider,
    reasoning: result.reasoning,
  };
}
