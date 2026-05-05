export async function execCommand(command: string): Promise<{ stdout: string; stderr: string; error: string | null }> {
  const res = await fetch('/api/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
  });
  return res.json();
}

export async function getLabDir(): Promise<string> {
  const res = await fetch('/api/cwd');
  const data = await res.json();
  return data.cwd;
}

export async function setLabDir(cwd: string): Promise<string> {
  const res = await fetch('/api/cwd', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd }),
  });
  const data = await res.json();
  return data.cwd;
}

/**
 * Extract code blocks from markdown text.
 * Returns array of { lang, code } objects.
 */
export function extractCodeBlocks(text: string): { lang: string; code: string }[] {
  const blocks: { lang: string; code: string }[] = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({ lang: match[1] || '', code: match[2].trim() });
  }
  return blocks;
}

/**
 * Classify what type of fix an AI response contains.
 */
export function classifyFix(text: string): 'yaml' | 'command' | 'mixed' | 'none' {
  const blocks = extractCodeBlocks(text);
  if (blocks.length === 0) return 'none';
  const hasYaml = blocks.some(b => ['yaml', 'yml'].includes(b.lang));
  const hasCmd = blocks.some(b => ['bash', 'sh', 'shell', ''].includes(b.lang) && !['yaml', 'yml'].includes(b.lang));
  if (hasYaml && hasCmd) return 'mixed';
  if (hasYaml) return 'yaml';
  if (hasCmd) return 'command';
  return 'none';
}
