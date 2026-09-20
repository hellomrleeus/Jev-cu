import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_BIN = path.join(PROJECT_DIR, "bin", "mac-ax");

function ensureBinary(binPath = DEFAULT_BIN) {
  if (fs.existsSync(binPath)) return;
  console.log(`[mac-driver] 未检测到 ${binPath}，正在自动编译...`);
  const buildScript = path.join(PROJECT_DIR, "scripts", "build-native.mjs");
  execSync(`node "${buildScript}"`, { stdio: "inherit" });
}

export function createMacDriver({ binPath = DEFAULT_BIN, timeoutMs = 10000 } = {}) {
  ensureBinary(binPath);

  let proc = null;
  let rl = null;
  let responseQueue = [];
  let isClosed = false;

  function initProcess() {
    if (proc && !proc.killed) return;
    proc = spawn(binPath, ["daemon"], {
      stdio: ["pipe", "pipe", "inherit"],
    });

    rl = readline.createInterface({ input: proc.stdout });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const json = JSON.parse(line);
        const resolver = responseQueue.shift();
        if (resolver) resolver.resolve(json);
      } catch (err) {
        const resolver = responseQueue.shift();
        if (resolver) resolver.reject(new Error(`Failed to parse daemon response: ${line}`));
      }
    });

    proc.on("error", (err) => {
      while (responseQueue.length > 0) {
        responseQueue.shift().reject(err);
      }
    });

    proc.on("exit", (code) => {
      isClosed = true;
      while (responseQueue.length > 0) {
        responseQueue.shift().reject(new Error(`Daemon exited with code ${code}`));
      }
    });
  }

  function sendCommand(cmdObj) {
    if (isClosed) {
      isClosed = false;
      initProcess();
    }
    initProcess();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Command timed out after ${timeoutMs}ms: ${JSON.stringify(cmdObj)}`));
      }, timeoutMs);

      responseQueue.push({
        resolve: (val) => {
          clearTimeout(timer);
          if (val && val.ok === false) {
            reject(new Error(val.error || "Driver command failed"));
          } else {
            resolve(val);
          }
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      proc.stdin.write(JSON.stringify(cmdObj) + "\n");
    });
  }

  return {
    async bind(appName) {
      const res = await sendCommand({ cmd: "bind", app: appName });
      return res;
    },

    async observe({ full = true, maxDepth = 30 } = {}) {
      const res = await sendCommand({ cmd: "observe", maxDepth });
      return res.axText;
    },

    async click(target, options = {}) {
      if (Array.isArray(target)) {
        return sendCommand({
          cmd: "click",
          at: target,
          button: options.mouseButton || "left",
        });
      }
      return sendCommand({
        cmd: "click",
        index: target,
        button: options.mouseButton || "left",
      });
    },

    async setValue(index, value) {
      return sendCommand({ cmd: "set_value", index, value: String(value ?? "") });
    },

    async typeText(text) {
      return sendCommand({ cmd: "type_text", text: String(text ?? "") });
    },

    async pressKey(key) {
      return sendCommand({ cmd: "press_key", key: String(key ?? "Return") });
    },

    async scroll(index, direction = "down", pages = 1) {
      return sendCommand({ cmd: "scroll", index, direction, pages });
    },

    async drag(from, to) {
      return sendCommand({ cmd: "drag", from, to });
    },

    async listApps() {
      const res = await sendCommand({ cmd: "apps" });
      return res.apps || [];
    },

    async isTrusted() {
      const res = await sendCommand({ cmd: "is_trusted" });
      return Boolean(res.trusted);
    },

    async close() {
      if (proc && !proc.killed) {
        try {
          await sendCommand({ cmd: "quit" });
        } catch {
          /* ignore */
        }
        proc.kill();
        isClosed = true;
      }
    },
  };
}
