import test from "node:test";
import assert from "node:assert/strict";
import { decide as antigravityDecide, detectEngineAvailability } from "../scripts/antigravity-decide.mjs";
import { runTask } from "../scripts/loop.mjs";

test("antigravity-decide 能够检测引擎可用性", () => {
  const avail = detectEngineAvailability();
  assert.ok(["jev", "antigravity"].includes(avail.defaultEngine));
  assert.equal(typeof avail.hasTypesafe, "boolean");
});

test("antigravity-decide 启发式引擎正确选择候选元素", async () => {
  const candidates = [
    { index: 10, role: "button", label: "Clear", score: 1 },
    { index: 12, role: "button", label: "7", score: 8 },
    { index: 13, role: "button", label: "8", score: 2 },
  ];

  const decision = await antigravityDecide({
    goal: "press 7",
    app: "Calculator",
    candidates,
    context: "Calculator window",
  });

  assert.equal(decision.engine, "antigravity");
  assert.equal(decision.targetIndex, 12);
  assert.equal(decision.action, "click_element");
  assert.ok(decision.confidence >= 0.8);
  assert.ok(decision.risk < 0.1);
});

test("antigravity-decide 对敏感操作标记高风险", async () => {
  const candidates = [
    { index: 5, role: "button", label: "Delete all files", score: 10 },
  ];

  const decision = await antigravityDecide({
    goal: "delete files",
    app: "Finder",
    candidates,
  });

  assert.equal(decision.targetIndex, 5);
  assert.ok(decision.risk >= 0.8, `敏感词应该标记高风险，实际为 ${decision.risk}`);
});

test("antigravity-decide 在 runTask 流程中可完整跑通", async () => {
  const mockAx = [
    'Window: "Calculator", App: Calculator.',
    "0 standard window Calculator",
    "\t1 button 7",
    "\t2 button Equals",
  ].join("\n");

  const driver = {
    bind: async () => {},
    observe: async () => mockAx,
    click: async () => {},
  };

  const result = await runTask({
    driver,
    appName: "Calculator",
    goal: "7",
    engine: "antigravity",
    dryRun: true,
    emit: () => {},
  });

  assert.equal(result.status, "dry_run");
  assert.equal(result.planned.targetIndex, 1);
});
