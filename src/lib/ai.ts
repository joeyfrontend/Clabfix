import type { MessageRole } from "../types";

type ChatTurn = {
  role: MessageRole;
  parts: { text: string }[];
};

type AIResponse = {
  text?: string;
  error?: string;
  retryAfterMs?: number | null;
};

async function postAi(body: unknown): Promise<string> {
  // 15-minute timeout — AI agentic loop can chain many commands
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 900_000);

  try {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = (await res.json()) as AIResponse;
    if (!res.ok || data.error) {
      throw new Error(data.error || `AI request failed (${res.status})`);
    }

    return data.text || "No response.";
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function analyzeTopology(yamlContent: string, model?: string) {
  return postAi({
    action: "analyzeTopology",
    yamlContent,
    model,
  });
}

export async function troubleshootLogs(logs: string, yamlContent?: string, model?: string) {
  return postAi({
    action: "troubleshootLogs",
    logs,
    yamlContent,
    model,
  });
}

export async function chatWithAI(history: ChatTurn[], topologyYaml?: string, model?: string) {
  return postAi({
    action: "chat",
    history,
    topologyYaml,
    model,
  });
}
