/**
 * ── src/server/plugin.ts ────────────────────────────────
 * CHANGES (Problems 2 & 5):
 *  1. /api/exec: spawn uses ['bash', '-c', command] with { cwd } as option
 *     object — never interpolated into shell string. Handles paths with spaces.
 *  2. /api/exec: stdout/stderr streamed to SSE immediately (no buffering).
 *  3. /api/exec: proper error handling — all errors return JSON, never crash.
 *  4. /api/cwd POST: auto-runs health check command after CWD change.
 *  5. /api/fs: accepts optional initialPath param for directory picker.
 *  6. /api/fs: falls back to user home dir when path is "/" or invalid.
 */

import type { Plugin, Connect } from "vite";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { globalLogStream } from "./events";
import { AIRequestError, createAIService, checkCommandSafety, type AIRequest } from "./ai";

function parseBody(req: Connect.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

export function clabfixApi(options: { apiKey?: string; model?: string } = {}): Plugin {
  let labDir = process.cwd();
  const aiService = createAIService({
    apiKey: options.apiKey,
    model: options.model,
    getLabDir: () => labDir,
  });

  return {
    name: "clabfix-api",
    configureServer(server) {
      // ── /api/fs — File system browser for DirectoryPicker ──
      server.middlewares.use("/api/fs", (req, res, next) => {
        if (req.method === "GET") {
          const url = new URL(req.url || "/", `http://${req.headers.host}`);
          let dirPath = url.searchParams.get("path") || process.cwd();

          // Problem 5: If path is "/" or empty, fall back to user home dir
          if (dirPath === "/" || !dirPath) {
            dirPath = os.homedir();
          }

          // Validate the path exists; if not, fall back to home
          try {
            if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
              dirPath = os.homedir();
            }
          } catch {
            dirPath = os.homedir();
          }

          try {
            const items = fs.readdirSync(dirPath, { withFileTypes: true });
            const folders = items
              .filter(item => item.isDirectory() && !item.name.startsWith('.'))
              .map(item => ({
                name: item.name,
                path: path.join(dirPath, item.name).replace(/\\/g, '/'),
              }));
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              folders,
              current: dirPath.replace(/\\/g, '/'),
              home: os.homedir().replace(/\\/g, '/'),
            }));
          } catch (err: any) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }
        next();
      });

      // ── /api/ai — AI requests ──
      server.middlewares.use("/api/ai", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }

        parseBody(req)
          .then(async (body: AIRequest) => {
            // Disable socket timeout — AI agentic loop can take minutes
            // when chaining multiple containerlab commands
            if (req.socket) req.socket.setTimeout(0);
            if (res.socket) res.socket.setTimeout(0);
            try {
              const text = await aiService.request(body);
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ text }));
            } catch (error) {
              const aiError =
                error instanceof AIRequestError
                  ? error
                  : new AIRequestError(error instanceof Error ? error.message : String(error));

              res.statusCode = aiError.statusCode;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  error: aiError.message,
                  retryAfterMs: aiError.retryAfterMs ?? null,
                })
              );
            }
          })
          .catch(() => {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Invalid request body" }));
          });
      });

      // ── /api/cwd — Get/set working directory ──
      server.middlewares.use("/api/cwd", (req, res) => {
        if (req.method === "GET") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ cwd: labDir }));
          return;
        }

        if (req.method === "POST") {
          parseBody(req)
            .then(({ cwd }) => {
              labDir = cwd;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ cwd: labDir }));

              // Problem 2: Auto-run health check after CWD change so
              // the terminal shows signs of life immediately.
              const healthCmd = `echo "▶ Terminal ready — $(pwd)"`;
              const child = spawn("bash", ["-c", healthCmd], { cwd: labDir });
              child.stdout.on("data", (data) => {
                globalLogStream.log(
                  JSON.stringify({ type: "stdout", text: data.toString() })
                );
              });
              child.on("close", () => {
                globalLogStream.log(
                  JSON.stringify({ type: "done", text: "[CWD changed]" })
                );
              });
              child.on("error", () => {}); // Swallow — CWD was already set
            })
            .catch(() => {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Bad request" }));
            });
          return;
        }

        res.statusCode = 405;
        res.end();
      });

      // ── /api/stream — SSE event stream ──
      server.middlewares.use("/api/stream", (req, res) => {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        });

        // data is already a JSON string from globalLogStream.log(JSON.stringify({...}))
        // Writing it directly — no second JSON.stringify — so client gets a proper object.
        const onLog = (data: string) => {
          res.write(`data: ${data}\n\n`);
        };

        globalLogStream.on("log", onLog);
        req.on("close", () => {
          globalLogStream.off("log", onLog);
        });
      });

      // ── /api/confirm — Approve/deny destructive commands ──
      server.middlewares.use("/api/confirm", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        parseBody(req)
          .then(({ approved }) => {
            globalLogStream.respondConfirm(!!approved);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, approved: !!approved }));
          })
          .catch(() => {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Invalid request" }));
          });
      });

      // ── /api/exec — Execute commands from terminal/frontend ──
      // Problem 2 fix: spawn with ['bash', '-c', command] and { cwd } as
      // option — safe for paths containing spaces. All errors caught and
      // returned as JSON, never crash the SSE connection.
      server.middlewares.use("/api/exec", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        parseBody(req)
          .then(({ command }) => {
            if (!command || typeof command !== "string") {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({
                stdout: "",
                stderr: "",
                exitCode: 1,
                error: "No command provided",
              }));
              return;
            }

            // Safety check for manual commands
            const safety = checkCommandSafety(command, labDir);
            if (safety.action === "reject") {
              globalLogStream.log(JSON.stringify({ type: "stderr", text: `[BLOCKED] ${safety.reason}\n` }));
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ stdout: "", stderr: safety.reason, exitCode: 1, error: `Blocked: ${safety.reason}` }));
              return;
            }

            let cmdToRun = command;
            if (safety.action === "auto_fix") {
              cmdToRun = safety.fixed;
              globalLogStream.log(JSON.stringify({ type: "stderr", text: `[AUTO-FIX] ${safety.reason}\n` }));
            }

            globalLogStream.log(JSON.stringify({ type: "exec", text: `$ ${cmdToRun}` }));

            // Strip ANSI escape codes for clean terminal display
            const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');

            const child = spawn("bash", ["-c", cmdToRun], { cwd: labDir });
            let stdout = "";
            let stderr = "";

            child.stdout.on("data", (data) => {
              const str = data.toString();
              stdout += str;
              globalLogStream.log(JSON.stringify({ type: "stdout", text: stripAnsi(str) }));
            });

            child.stderr.on("data", (data) => {
              const str = data.toString();
              stderr += str;
              globalLogStream.log(JSON.stringify({ type: "stderr", text: stripAnsi(str) }));
            });

            child.on("close", (code) => {
              globalLogStream.log(
                JSON.stringify({ type: "done", text: `[exit ${code}]` })
              );
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  stdout: stdout.trim(),
                  stderr: stderr.trim(),
                  exitCode: code ?? 0,
                  error: code !== 0 ? `Process exited with code ${code}` : null,
                })
              );
            });

            child.on("error", (error) => {
              globalLogStream.log(
                JSON.stringify({ type: "error", text: `Error: ${error.message}` })
              );
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  stdout: stdout.trim(),
                  stderr: stderr.trim(),
                  exitCode: 1,
                  error: error.message,
                })
              );
            });
          })
          .catch((err) => {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              stdout: "",
              stderr: "",
              exitCode: 1,
              error: err?.message || "Invalid request body",
            }));
          });
      });
    },
  };
}
