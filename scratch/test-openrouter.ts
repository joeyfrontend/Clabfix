import fs from 'fs';
import path from 'path';

async function testOpenRouter() {
  const envContent = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf-8');
  const apiKeyMatch = envContent.match(/OPENROUTER_API_KEY="([^"]+)"/);
  const apiKey = apiKeyMatch ? apiKeyMatch[1] : null;
  if (!apiKey) {
    console.log("No API Key");
    return;
  }

  const models = [
    "google/gemini-2.0-flash-001",
    "anthropic/claude-3.5-sonnet",
    "meta-llama/llama-3.3-70b-instruct",
    "qwen/qwen-2.5-coder-32b-instruct"
  ];

  for (const model of models) {
    try {
      console.log(`Testing ${model}...`);
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Say hi" }],
          tools: [{
            type: "function",
            function: {
              name: "execute_cli_command",
              description: "Executes a shell command on the host.",
              parameters: {
                type: "object",
                properties: { command: { type: "string" } },
                required: ["command"]
              }
            }
          }]
        })
      });
      if (res.ok) {
        console.log(`  Success!`);
      } else {
        const text = await res.text();
        console.log(`  Failed: ${res.status} ${text}`);
      }
    } catch (err: any) {
      console.log(`  Exception: ${err.message}`);
    }
  }
}

testOpenRouter();
