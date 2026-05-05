# Clabfix

AI-powered troubleshooting agent for [Containerlab](https://containerlab.dev/) network topologies and diagnostic logs.

## Features

- **Topology Analysis** — Paste your `.clab.yml` and get instant AI-driven lint + architectural review
- **Log Troubleshooting** — Feed in `docker logs`, `dmesg`, or `clab deploy` output for error detection
- **Connectivity Checks** — Full-mesh ping sweep simulation and gateway reachability analysis
- **Automated Remediation** — Get exact fix commands with explanations; copy to clipboard in one click
- **Dynamic Node Sidebar** — Parses your YAML in real-time to show active nodes and topology map

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript |
| Styling | Tailwind CSS v4 |
| AI Backend | Local Vite API proxy + Groq API (`groq-sdk`) |
| Build | Vite 6 |
| Animations | Motion (Framer Motion) |
| Markdown | react-markdown + remark-gfm |

## Getting Started

```bash
# Install dependencies
npm install

# Copy .env.example to .env (Windows: copy, Mac/Linux: cp)
copy .env.example .env

# Add your Groq API key to .env (Get it from https://console.groq.com/keys)
# GROQ_API_KEY="your-key-here"

# Optional: change the model if you want to test a different one
# GROQ_MODEL="llama-3.3-70b-versatile"

# Start dev server
npm run dev
```

The app will be available at `http://localhost:3000`.

## Project Structure

```
src/
├── App.tsx                  # Main orchestrator
├── types.ts                 # Shared TypeScript types
├── main.tsx                 # React entry point
├── index.css                # Global styles & theme tokens
├── lib/
│   ├── ai.ts                # Groq AI service layer
│   └── utils.ts             # Utility functions (cn)
└── components/
    ├── Sidebar.tsx           # Left nav with dynamic node list
    ├── ChatPanel.tsx         # Diagnostic chat with message list
    ├── MessageBubble.tsx     # Individual message with markdown rendering
    ├── TopologyEditor.tsx    # YAML topology editor
    ├── LogAnalyzer.tsx       # Log paste & analysis
    ├── ConnectivityCheck.tsx  # Connectivity sweep module
    └── MetricsPanel.tsx      # Right panel with metrics & topo map
```

## Security Note

Groq API calls are proxied through the local Vite server, so the API key is never exposed in the browser bundle. If you previously served a build that embedded the key client-side, rotate that key before continuing.

## Rate Limiting

The AI proxy serializes Groq requests, honors retry windows returned by the API, and caches identical requests briefly so repeated clicks do not burn extra quota. If you still see long cooldowns after this change, the current key is likely exhausted.

## License

MIT
