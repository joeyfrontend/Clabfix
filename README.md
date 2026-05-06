# Clabfix

AI-powered autonomous troubleshooting agent for [Containerlab](https://containerlab.dev/) network topologies and diagnostic logs.

## Features

- **Topology Analysis** — Paste your `.clab.yml` and get instant AI-driven lint + architectural review
- **Automated Remediation** — Agent automatically generates exact fix scripts and commands.
- **Live Interactive Terminal** — Run `containerlab deploy` or bash commands directly from the UI and watch live streaming outputs.
- **Visual Directory Picker** — IDE-style native folder selection to automatically set your lab's working directory.
- **Dynamic Model Selection** — Switch between powerful models (Gemini 2.0 Flash, Llama 3.3 70B, etc.) on the fly via the OpenRouter integration.
- **Dynamic Node Sidebar** — Parses your YAML in real-time to show active nodes and a live topology map.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript |
| Styling | Tailwind CSS v4 |
| AI Backend | Standalone Express Server + OpenRouter API |
| Build | Vite 6 |
| Animations | Motion (Framer Motion) |
| System Access| `child_process` execution + `fs` filesystem browsing |

## Getting Started

```bash
# Clone the repository
git clone https://github.com/joeyfrontend/Clabfix.git
cd Clabfix

# Install dependencies
npm install

# Copy .env.example to .env (Windows: copy, Mac/Linux: cp)
cp .env.example .env

# Add your OpenRouter API key to .env (Get it from https://openrouter.ai/)
# OPENROUTER_API_KEY="sk-or-v1-..."

# Start dev server
npm run dev
```

The app will be available at `http://localhost:3000`.

## Project Structure

```
src/
├── App.tsx                  # Main orchestrator & routing
├── types.ts                 # Shared TypeScript types
├── main.tsx                 # React entry point
├── lib/
│   ├── ai.ts                # Frontend AI request wrapper
│   ├── api.ts               # Terminal & FS commands bridging
│   └── utils.ts             # Utility functions
├── server/
│   ├── index.ts             # Standalone Express backend API
│   ├── ai.ts                # OpenRouter AI core logic & Tool Calling
│   └── events.ts            # Server-Sent Events stream manager
└── components/
    ├── Sidebar.tsx           # Left nav with dynamic node list
    ├── ChatPanel.tsx         # AI chat & Interactive Terminal UI
    ├── MessageBubble.tsx     # Message rendering
    ├── TopologyEditor.tsx    # YAML topology editor
    ├── DirectoryPicker.tsx   # Native file system browser modal
    └── MetricsPanel.tsx      # Right panel with metrics & topo map
```

## AI Model Compatibility

The backend uses **Tool Calling** (Function Calling) to automatically execute terminal commands. If you are using a free OpenRouter tier, ensure you select a model that natively supports tools.
- **Supported / Recommended:** `google/gemini-2.0-flash-001`, `meta-llama/llama-3.3-70b-instruct`
- **Unsupported (Free Tier):** `qwen/qwen-2.5-coder-32b-instruct` (Will drop connection if asked to execute commands).

## Security Note

OpenRouter API calls are proxied securely through the local Vite Node.js server. The API key is strictly maintained backend-side and never exposed in the browser bundle.

## License

MIT
