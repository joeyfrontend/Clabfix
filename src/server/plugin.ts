import type { Plugin, Connect } from "vite";
import { exec, spawn } from "child_process";
import { globalLogStream } from "./events";
import { AIRequestError, createAIService, type AIRequest } from "./ai";

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

export function clabfixApi(options: { groqApiKey?: string; groqModel?: string } = {}): Plugin {
  let labDir = process.cwd();
  const aiService = createAIService({
    apiKey: options.groqApiKey,
    model: options.groqModel,
    getLabDir: () => labDir,
  });

  return {
    name: "clabfix-api",
    configureServer(server) {
      server.middlewares.use("/api/ai", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }

        parseBody(req)
          .then(async (body: AIRequest) => {
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
            })
            .catch(() => {
              res.statusCode = 400;
              res.end("Bad request");
            });
          return;
        }

        res.statusCode = 405;
        res.end();
      });

      // Inside configureServer...
      server.middlewares.use("/api/stream", (req, res) => {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        });

        const onLog = (data: string) => {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        globalLogStream.on("log", onLog);
        req.on("close", () => {
          globalLogStream.off("log", onLog);
        });
      });

      server.middlewares.use("/api/exec", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }

        parseBody(req)
          .then(({ command }) => {
            if (!command || typeof command !== "string") {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "No command provided" }));
              return;
            }

            globalLogStream.log(JSON.stringify({ type: 'exec', text: `$ ${command}` }));
            
            const child = spawn(command, { cwd: labDir, shell: true });
            let stdout = "";
            let stderr = "";

            child.stdout.on("data", (data) => {
              const str = data.toString();
              stdout += str;
              globalLogStream.log(JSON.stringify({ type: 'stdout', text: str }));
            });

            child.stderr.on("data", (data) => {
              const str = data.toString();
              stderr += str;
              globalLogStream.log(JSON.stringify({ type: 'stderr', text: str }));
            });

            child.on("close", (code) => {
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
               globalLogStream.log(JSON.stringify({ type: 'error', text: `Error: ${error.message}` }));
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
          .catch(() => {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Invalid request body" }));
          });
      });
    },
  };
}
