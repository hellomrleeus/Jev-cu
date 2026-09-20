#!/usr/bin/env node
/**
 * 编译 native/mac-ax.swift 到 bin/mac-ax
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(PROJECT_DIR, "native", "mac-ax.swift");
const BIN_DIR = path.join(PROJECT_DIR, "bin");
const OUT = path.join(BIN_DIR, "mac-ax");

fs.mkdirSync(BIN_DIR, { recursive: true });

console.log(`[build-native] 正在编译 ${SRC} -> ${OUT}...`);
try {
  execSync(`swiftc -O "${SRC}" -o "${OUT}"`, { stdio: "inherit" });
  console.log(`[build-native] 编译成功：${OUT}`);
} catch (err) {
  console.error(`[build-native] 编译失败：${err.message}`);
  process.exit(1);
}
