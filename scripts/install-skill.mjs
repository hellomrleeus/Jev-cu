#!/usr/bin/env node
/**
 * 把项目里的 skill/jev-cu 安装到 Antigravity 技能目录。
 *
 *   node scripts/install-skill.mjs            # 安装到当前项目的 .agents/skills/jev-cu（推荐）
 *   node scripts/install-skill.mjs --global   # 安装到全局 ~/.gemini/config/skills/jev-cu
 *   node scripts/install-skill.mjs --link     # 软链安装
 *   node scripts/install-skill.mjs --uninstall
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(PROJECT_DIR, "skill", "jev-cu");
const REPO_DIR_PLACEHOLDER = "{{REPO_DIR}}";

const isGlobal = process.argv.includes("--global");
const uninstall = process.argv.includes("--uninstall");
const link = process.argv.includes("--link");

const DEST = isGlobal
  ? path.join(os.homedir(), ".gemini", "config", "skills", "jev-cu")
  : path.join(PROJECT_DIR, ".agents", "skills", "jev-cu");

/** 把 skill 文本里的 {{REPO_DIR}} 替换成本机项目路径（复制安装时执行） */
function materializeRepoDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) materializeRepoDir(p);
    else if (entry.isFile()) {
      const text = fs.readFileSync(p, "utf8");
      const replaced = text.split(REPO_DIR_PLACEHOLDER).join(PROJECT_DIR);
      if (replaced !== text) fs.writeFileSync(p, replaced);
    }
  }
}

if (uninstall) {
  fs.rmSync(DEST, { recursive: true, force: true });
  console.log(`已卸载：${DEST}`);
  process.exit(0);
}

if (!fs.existsSync(path.join(SRC, "SKILL.md"))) {
  console.error(`源 skill 不存在：${SRC}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(DEST), { recursive: true });
fs.rmSync(DEST, { recursive: true, force: true });

if (link) {
  fs.symlinkSync(SRC, DEST, "dir");
  console.log(`已软链安装：${DEST} → ${SRC}`);
} else {
  fs.cpSync(SRC, DEST, { recursive: true });
  materializeRepoDir(DEST);
  console.log(`已安装到 Antigravity 技能目录：${DEST}`);
}

console.log("\n安装完成！Antigravity 在新会话中将自动发现并激活此 Skill。");
console.log("卸载命令：node scripts/install-skill.mjs --uninstall");
