import type { Plugin, Connect } from "vite";
import { exec } from "child_process";
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

            exec(command, { cwd: labDir, shell: "true", timeout: 30_000 }, (error, stdout, stderr) => {
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  stdout: stdout || "",
                  stderr: stderr || "",
                  exitCode: error?.code ?? 0,
                  error: error?.message || null,
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
