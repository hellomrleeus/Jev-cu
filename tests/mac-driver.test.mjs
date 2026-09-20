import test from "node:test";
import assert from "node:assert/strict";
import { createMacDriver } from "../scripts/driver/mac-driver.mjs";
import { parseAX, selectCandidates } from "../scripts/loop.mjs";

test("mac-driver 检查辅助功能权限与进程列表", async () => {
  const driver = createMacDriver();
  try {
    const trusted = await driver.isTrusted();
    assert.equal(typeof trusted, "boolean");
    assert.equal(trusted, true, "macOS 辅助功能权限应处于开启状态");

    const apps = await driver.listApps();
    assert.ok(Array.isArray(apps));
    assert.ok(apps.length > 0, "应能获取当前运行的 App 列表");
  } finally {
    await driver.close();
  }
});

test("mac-driver 绑定计算器并获取 AX 状态树", async () => {
  const driver = createMacDriver();
  try {
    const bindRes = await driver.bind("计算器");
    assert.equal(bindRes.ok, true);

    const axText = await driver.observe({ full: true });
    assert.ok(typeof axText === "string" && axText.length > 0);
    assert.ok(axText.includes("计算器") || axText.includes("Calculator"));

    const elements = parseAX(axText);
    assert.ok(elements.length > 5, `应解析出多个 AX 元素，实际得到 ${elements.length}`);

    // 测试候选抽取
    const candidates = selectCandidates(elements, "clear all", { max: 20 });
    assert.ok(candidates.length > 0, "应成功提取候选元素");
  } finally {
    await driver.close();
  }
});
