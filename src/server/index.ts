import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { globalLogStream, activeProcesses, killAllProcesses } from './events.js';
import { AIRequestError, createAIService, checkCommandSafety, type AIRequest } from './ai.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

let labDir = process.cwd();
const aiService = createAIService({
  apiKey: process.env.OPENROUTER_API_KEY,
  model: process.env.OPENROUTER_MODEL,
  getLabDir: () => labDir,
});

// ── /api/fs — File system browser for DirectoryPicker ──
app.get("/api/fs", (req, res) => {
  let dirPath = (req.query.path as string) || process.cwd();

  if (dirPath === "/" || !dirPath) {
    dirPath = os.homedir();
  }

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
    res.json({
      folders,
      current: dirPath.replace(/\\/g, '/'),
      home: os.homedir().replace(/\\/g, '/'),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── /api/ai — AI requests ──
app.post("/api/ai", async (req, res) => {
  // Disable timeouts
  req.setTimeout(0);
  res.setTimeout(0);

  try {
    const text = await aiService.request(req.body);
    res.json({ text });
  } catch (error) {
    const aiError = error instanceof AIRequestError
      ? error
      : new AIRequestError(error instanceof Error ? error.message : String(error));
    
    res.status(aiError.statusCode).json({
      error: aiError.message,
      retryAfterMs: aiError.retryAfterMs ?? null,
    });
  }
});

// ── /api/cwd — Get/set working directory ──
app.get("/api/cwd", (req, res) => {
  res.json({ cwd: labDir });
});

app.post("/api/cwd", (req, res) => {
  const { cwd } = req.body;
  if (!cwd || typeof cwd !== "string") {
    return res.status(400).json({ error: "Missing cwd field" });
  }
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    return res.status(400).json({ error: "Directory does not exist" });
  }
  labDir = cwd;
  res.json({ cwd: labDir });

  // Optional: scan dir
  setTimeout(() => {
    globalLogStream.log(JSON.stringify({ type: "exec", text: `$ Scanning directory...` }));
    const child = spawn("ls", ["-la"], { cwd: labDir, detached: true });
    activeProcesses.add(child);
    
    let stdout = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.on("exit", (code) => {
      activeProcesses.delete(child);
      const out = stdout.substring(0, 1000);
      globalLogStream.log(JSON.stringify({ type: "info", text: `[Directory updated] Found ${out.split('\n').length} items.` }));
      globalLogStream.log(JSON.stringify({ type: "done", text: `[exit ${code ?? 0}]` }));
    });
  }, 500);
});

// ── /api/stream — SSE event stream ──
app.get("/api/stream", (req, res) => {
  req.setTimeout(0);
  res.setTimeout(0);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const keepalive = setInterval(() => {
    res.write(":keepalive\n\n");
  }, 15_000);

  const onLog = (data: string) => {
    try {
      if (!res.writableEnded) {
        res.write(`data: ${data}\n\n`);
      }
    } catch (e) {}
  };

  globalLogStream.on("log", onLog);
  
  const cleanup = () => {
    clearInterval(keepalive);
    globalLogStream.off("log", onLog);
  };
  
  req.on("close", cleanup);
  req.on("error", cleanup);
  res.on("error", cleanup);
});

// ── /api/topology — Read .clab.yml from CWD ──
app.get("/api/topology", (req, res) => {
  try {
    const items = fs.readdirSync(labDir);
    const clabFiles = items.filter(item => item.endsWith('.clab.yml') || item.endsWith('.clab.yaml'));
    
    if (clabFiles.length > 0) {
      const fileToLoad = (req.query.file as string) || clabFiles[0];
      if (clabFiles.includes(fileToLoad)) {
        const filePath = path.join(labDir, fileToLoad);
        const content = fs.readFileSync(filePath, 'utf-8');
        res.json({ found: true, yaml: content, filename: fileToLoad, availableFiles: clabFiles });
        return;
      }
    }
    res.json({ found: false, yaml: null, filename: null, availableFiles: [] });
  } catch (err: any) {
    res.json({ found: false, yaml: null, error: err.message, availableFiles: [] });
  }
});

// ── /api/kill — Force kill all active processes ──
app.post("/api/kill", (req, res) => {
  const killed = killAllProcesses();
  res.json({ success: true, killed });
});

// ── /api/confirm — Handle confirmation feedback ──
app.post("/api/confirm", (req, res) => {
  const { approved } = req.body;
  globalLogStream.emit("confirm", !!approved);
  res.json({ success: true });
});

// ── /api/exec — Manual shell execution ──
app.post("/api/exec", (req, res) => {
  const { command } = req.body;
  if (!command || typeof command !== "string") {
    return res.status(400).json({ error: "Missing command field" });
  }

  const safety = checkCommandSafety(command, labDir);
  if (safety.action === "reject") {
    globalLogStream.log(JSON.stringify({ type: "error", text: `[SECURITY] ${safety.reason}` }));
    return res.status(403).json({ error: safety.reason });
  }

  if (safety.action === "confirm") {
    globalLogStream.log(JSON.stringify({ type: "confirm_required", text: command }));
    
    const onConfirm = (approved: boolean) => {
      globalLogStream.off("confirm", onConfirm);
      if (!approved) {
        globalLogStream.log(JSON.stringify({ type: "stderr", text: `[User Denied]: ${command}\n` }));
        globalLogStream.log(JSON.stringify({ type: "done", text: `[exit 1]` }));
        return res.json({ stdout: "", stderr: "User denied", exitCode: 1, error: "Denied" });
      }
      
      executeRealCommand(command, labDir, res);
    };
    
    globalLogStream.on("confirm", onConfirm);
    return;
  }

  executeRealCommand(safety.action === "auto_fix" ? safety.fixed! : command, labDir, res);
});

function executeRealCommand(cmdToRun: string, cwd: string, res: express.Response) {
  globalLogStream.log(JSON.stringify({ type: "exec", text: `$ ${cmdToRun}` }));

  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');

  const child = spawn("bash", ["-c", cmdToRun], { cwd, detached: true });
  activeProcesses.add(child);
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

  let responseSent = false;
  child.on("exit", (code) => {
    setTimeout(() => {
      if (responseSent) return;
      responseSent = true;
      activeProcesses.delete(child);
      globalLogStream.log(JSON.stringify({ type: "done", text: `[exit ${code ?? 137}]` }));
      res.json({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 0,
        error: code !== 0 ? `Process exited with code ${code}` : null,
      });
    }, 50);
  });

  child.on("error", (error) => {
    if (responseSent) return;
    responseSent = true;
    activeProcesses.delete(child);
    globalLogStream.log(JSON.stringify({ type: "error", text: `Error: ${error.message}` }));
    res.status(500).json({ error: error.message });
  });
}

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Clabfix Backend API running on http://0.0.0.0:${PORT}`);
});
