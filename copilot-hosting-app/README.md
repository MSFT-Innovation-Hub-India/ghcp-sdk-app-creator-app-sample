# GitHub Copilot SDK - Python App Factory

A host application that demonstrates how to use the **GitHub Copilot SDK** to programmatically create Python applications through natural language prompts.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [How It Works](#how-it-works)
- [SDK and CLI Requirements](#sdk-and-cli-requirements)
- [Custom Tools](#custom-tools)
- [The Agent Loop](#the-agent-loop)
- [Workspace Management](#workspace-management)
- [LLM and Model Configuration](#llm-and-model-configuration)
- [Running the Application](#running-the-application)

---

## Overview

This application showcases the **GitHub Copilot SDK** capabilities by building a "Python App Factory" - a web-based tool that:

1. Accepts natural language descriptions of Python applications
2. Uses Copilot's agentic capabilities to generate complete project structures
3. Creates files, runs tests, and provides a working application

**Key Value Proposition**: Instead of manually using VS Code's Copilot Agent Mode or the Copilot CLI interactively, this SDK allows you to embed the same agentic code-generation capabilities into your own applications programmatically.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              HOST APPLICATION                                    │
│  ┌─────────────────┐    ┌──────────────────┐    ┌────────────────────────────┐  │
│  │                 │    │                  │    │                            │  │
│  │   Web Browser   │───▶│  Express Server  │───▶│    GitHub Copilot SDK      │  │
│  │   (localhost:   │    │  (index.js)      │    │  (@github/copilot-sdk)     │  │
│  │    3000)        │    │                  │    │                            │  │
│  │                 │◀───│  SSE Streaming   │◀───│  - CopilotClient           │  │
│  └─────────────────┘    └──────────────────┘    │  - defineTool()            │  │
│                                                  │  - Session Events          │  │
│                                                  └─────────────┬──────────────┘  │
│                                                                │                 │
│                         ┌──────────────────────────────────────┘                 │
│                         │  JSON-RPC (stdio)                                      │
│                         ▼                                                        │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                         COPILOT CLI (Server Mode)                         │   │
│  │                         copilot --acp (Agent Client Protocol)             │   │
│  │                                                                           │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐   │   │
│  │  │  Agent Runtime  │  │  Tool Executor  │  │  Context Management     │   │   │
│  │  │  (Planning,     │  │  (Calls your    │  │  (Infinite Sessions,    │   │   │
│  │  │   Reasoning)    │  │   custom tools) │  │   Compaction)           │   │   │
│  │  └────────┬────────┘  └────────┬────────┘  └─────────────────────────┘   │   │
│  │           │                    │                                          │   │
│  │           └────────────────────┴──────────────────────────────────────┐   │   │
│  │                                                                        │   │   │
│  └────────────────────────────────────────────────────────────────────────┼───┘   │
│                                                                           │       │
└───────────────────────────────────────────────────────────────────────────┼───────┘
                                                                            │
                                    ┌───────────────────────────────────────┘
                                    │  HTTPS (Authenticated)
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                              GITHUB COPILOT SERVICE                                │
│                                                                                    │
│  ┌────────────────────────────────────────────────────────────────────────────┐   │
│  │                           LLM MODELS                                        │   │
│  │                                                                             │   │
│  │   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐    │   │
│  │   │   GPT-4.1   │   │   GPT-5     │   │  Claude     │   │  Claude     │    │   │
│  │   │  (default)  │   │             │   │  Sonnet 4.5 │   │  Haiku 4.5  │    │   │
│  │   └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘    │   │
│  │                                                                             │   │
│  └────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                    │
│  ┌────────────────────────────────────────────────────────────────────────────┐   │
│  │                    AUTHENTICATION & BILLING                                 │   │
│  │          (GitHub Copilot subscription, Premium request quota)               │   │
│  └────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                    │
└───────────────────────────────────────────────────────────────────────────────────┘


┌───────────────────────────────────────────────────────────────────────────────────┐
│                              LOCAL FILESYSTEM                                      │
│                                                                                    │
│  workspaces/                                                                       │
│  └── fast_api_manages_app/          ◀── Created by SDK via write_file tool        │
│      ├── README.md                                                                 │
│      ├── requirements.txt                                                          │
│      ├── app/                                                                      │
│      │   ├── __init__.py                                                           │
│      │   └── main.py                 ◀── FastAPI application                       │
│      └── tests/                                                                    │
│          ├── __init__.py                                                           │
│          └── test_main.py            ◀── Pytest tests                              │
│                                                                                    │
└───────────────────────────────────────────────────────────────────────────────────┘


┌───────────────────────────────────────────────────────────────────────────────────┐
│                              DOCKER CONTAINER                                      │
│                                                                                    │
│  py-runner (Python 3.11)                                                           │
│  ├── Mounts: /workspace ◀── workspaces/fast_api_manages_app/                       │
│  ├── Creates venv, installs deps                                                   │
│  ├── Runs pytest                                                                   │
│  └── Reports success/failure                                                       │
│                                                                                    │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## How It Works

### Step-by-Step Flow

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                           REQUEST FLOW                                            │
└──────────────────────────────────────────────────────────────────────────────────┘

  User                    Host App                SDK                CLI              LLM
   │                         │                     │                  │                │
   │ 1. Enter prompt         │                     │                  │                │
   │ "Create FastAPI app     │                     │                  │                │
   │  for books with CRUD"   │                     │                  │                │
   │────────────────────────▶│                     │                  │                │
   │                         │                     │                  │                │
   │                         │ 2. Create workspace │                  │                │
   │                         │    directory        │                  │                │
   │                         │                     │                  │                │
   │                         │ 3. Create session   │                  │                │
   │                         │    with tools       │                  │                │
   │                         │────────────────────▶│                  │                │
   │                         │                     │                  │                │
   │                         │                     │ 4. Spawn CLI     │                │
   │                         │                     │    in server     │                │
   │                         │                     │    mode (--acp)  │                │
   │                         │                     │─────────────────▶│                │
   │                         │                     │                  │                │
   │                         │                     │ 5. JSON-RPC      │                │
   │                         │                     │    connection    │                │
   │                         │                     │◀────────────────▶│                │
   │                         │                     │                  │                │
   │                         │ 6. Send prompt      │                  │                │
   │                         │    with system msg  │                  │                │
   │                         │────────────────────▶│                  │                │
   │                         │                     │                  │ 7. Forward to  │
   │                         │                     │                  │    LLM         │
   │                         │                     │                  │───────────────▶│
   │                         │                     │                  │                │
   │                         │                     │                  │ 8. LLM decides │
   │                         │                     │                  │    to call     │
   │                         │                     │                  │    write_file  │
   │                         │                     │                  │◀───────────────│
   │                         │                     │                  │                │
   │                         │                     │ 9. Tool call:    │                │
   │                         │                     │    write_file    │                │
   │                         │                     │◀─────────────────│                │
   │                         │                     │                  │                │
   │                         │ 10. Execute tool    │                  │                │
   │                         │     handler         │                  │                │
   │                         │◀────────────────────│                  │                │
   │                         │                     │                  │                │
   │                         │ 11. Write file to   │                  │                │
   │                         │     workspace/      │                  │                │
   │                         │     app/main.py     │                  │                │
   │                         │                     │                  │                │
   │ 12. SSE: file created   │                     │                  │                │
   │◀────────────────────────│                     │                  │                │
   │                         │                     │                  │                │
   │                         │ 13. Tool result     │                  │                │
   │                         │────────────────────▶│                  │                │
   │                         │                     │─────────────────▶│                │
   │                         │                     │                  │───────────────▶│
   │                         │                     │                  │                │
   │         (Repeat steps 8-13 for each file: requirements.txt, tests, etc.)         │
   │                         │                     │                  │                │
   │                         │                     │ 14. Session idle │                │
   │                         │                     │◀─────────────────│                │
   │                         │                     │                  │                │
   │                         │ 15. Run tests       │                  │                │
   │                         │     in Docker       │                  │                │
   │                         │                     │                  │                │
   │ 16. SSE: test results   │                     │                  │                │
   │◀────────────────────────│                     │                  │                │
   │                         │                     │                  │                │
   │ 17. SSE: done           │                     │                  │                │
   │◀────────────────────────│                     │                  │                │
   │                         │                     │                  │                │
```

---

## SDK and CLI Requirements

### The `--server` Flag Issue

When we first built this application, we encountered this error:

```
[CLI subprocess] error: unknown option '--server'
```

**Root Cause**: The GitHub Copilot SDK communicates with the Copilot CLI via JSON-RPC. The SDK expects the CLI to run in "server mode" where it listens for commands over a protocol. Older CLI versions didn't have this capability.

### Version Requirements

| Component | Minimum Version | We Used | Notes |
|-----------|-----------------|---------|-------|
| `@github/copilot-sdk` | 0.1.x | **0.1.19** | Latest npm package |
| `@github/copilot` (CLI) | 0.0.380+ | **0.0.397** | Must have `--acp` flag |
| Node.js | 18+ | 18+ | For ES modules |

### How to Update

```bash
# Update the SDK
npm update @github/copilot-sdk

# Update the CLI
npm update -g @github/copilot
```

### CLI Server Mode

The SDK spawns the CLI with the `--acp` flag (Agent Client Protocol):

```
copilot --acp --port <random>
```

This starts the CLI as a JSON-RPC server that the SDK can communicate with programmatically.

---

## Custom Tools

### What Are Tools?

Tools are functions that the **LLM can decide to call** during its reasoning process. When you define a tool:

1. You describe what it does (description)
2. You define what parameters it accepts (JSON schema)
3. You provide a handler function that executes when called

The LLM sees these tool definitions and can choose to invoke them as part of generating its response.

### Tools We Defined

```javascript
// In agent_backend.js

// Tool 1: Write files to the workspace
defineTool("write_file", {
  description: "Write content to a file in the project workspace",
  parameters: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "Relative path to the file" },
      content: { type: "string", description: "The full content to write" },
    },
    required: ["filePath", "content"],
  },
  handler: async ({ filePath, content }) => {
    // Sanitize path, create directories, write file
    fs.writeFileSync(fullPath, content, "utf8");
    return { success: true, path: filePath };
  },
});

// Tool 2: Read files from the workspace
defineTool("read_file", {
  description: "Read the content of a file from the project workspace",
  parameters: { ... },
  handler: async ({ filePath }) => {
    return { content: fs.readFileSync(fullPath, "utf8") };
  },
});

// Tool 3: List files in the workspace
defineTool("list_files", {
  description: "List all files in the project workspace",
  parameters: { ... },
  handler: async ({ directory }) => {
    return { files: listRecursive(targetDir) };
  },
});
```

### How Files Get Created

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         FILE CREATION FLOW                                       │
└─────────────────────────────────────────────────────────────────────────────────┘

1. User prompt: "Create a FastAPI app for managing books"

2. System message instructs the LLM:
   "Use the write_file tool to create each file in the project"

3. LLM decides to create app/main.py:
   
   LLM Response (internal):
   {
     "tool_calls": [{
       "name": "write_file",
       "arguments": {
         "filePath": "app/main.py",
         "content": "from fastapi import FastAPI\n\napp = FastAPI()..."
       }
     }]
   }

4. SDK receives tool call, executes our handler:
   
   handler({ filePath: "app/main.py", content: "..." })
   └── fs.writeFileSync("workspaces/my_app/app/main.py", content)

5. Handler returns result to SDK → CLI → LLM

6. LLM continues, decides to create next file...

7. Repeat until all files created (README.md, requirements.txt, tests, etc.)
```

---

## The Agent Loop

### Is This Using an "Agent" or Just a Model?

**Yes, this is using Copilot's Agent capabilities**, not just a simple chat completion.

The key difference:

| Simple LLM Call | Agent Mode (What We Use) |
|-----------------|--------------------------|
| Single request → response | Multi-turn planning and execution |
| No tool calling | Can call tools (write_file, etc.) |
| No persistent state | Session with context management |
| No reasoning loop | Plans → executes → evaluates → continues |

### The Agentic Loop

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         COPILOT AGENT LOOP                                       │
└─────────────────────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────────────┐
                    │         USER PROMPT             │
                    │  "Create a FastAPI app for      │
                    │   managing books with CRUD"     │
                    └───────────────┬─────────────────┘
                                    │
                                    ▼
                    ┌─────────────────────────────────┐
                    │          PLANNING               │
                    │  "I need to create:             │
                    │   - README.md                   │
                    │   - requirements.txt            │
                    │   - app/__init__.py             │
                    │   - app/main.py                 │
                    │   - tests/__init__.py           │
                    │   - tests/test_main.py"         │
                    └───────────────┬─────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               │
        ┌─────────────────────┐                     │
        │    TOOL CALL        │                     │
        │    write_file       │                     │
        │    (README.md)      │                     │
        └──────────┬──────────┘                     │
                   │                                │
                   ▼                                │
        ┌─────────────────────┐                     │
        │    TOOL RESULT      │                     │
        │    { success: true }│                     │
        └──────────┬──────────┘                     │
                   │                                │
                   ▼                                │
        ┌─────────────────────┐                     │
        │    EVALUATE         │◀────────────────────┘
        │    "Continue with   │
        │     next file..."   │──────┐
        └─────────────────────┘      │
                                     │ Loop until
                                     │ all files done
                                     │
                    ┌────────────────┘
                    │
                    ▼
        ┌─────────────────────┐
        │    SUMMARIZE        │
        │    "All files       │
        │     created..."     │
        └──────────┬──────────┘
                   │
                   ▼
        ┌─────────────────────┐
        │    SESSION IDLE     │
        │    (Generation      │
        │     complete)       │
        └─────────────────────┘
```

---

## Workspace Management

### What is a Workspace?

A workspace is a directory where all generated files for a project are stored:

```
workspaces/
├── fast_api_manages_app/           # Generated from "FastAPI app for books"
│   ├── README.md
│   ├── requirements.txt
│   ├── app/
│   │   ├── __init__.py
│   │   └── main.py
│   └── tests/
│       ├── __init__.py
│       └── test_main.py
│
├── todo_list_app/                  # Another generated project
│   └── ...
│
└── weather_api_app/                # Yet another
    └── ...
```

### Workspace Creation Flow

```javascript
// In server/index.js

// 1. Generate project name from user prompt
const projectName = generateProjectName(userPrompt, jobId);
// "Create FastAPI app for books" → "fast_api_manages_app"

// 2. Create workspace directory
const projectDir = path.join(WORKSPACES, projectName);
ensureDir(projectDir);  // Creates: workspaces/fast_api_manages_app/

// 3. Pass to Copilot SDK - tools write files here
await generateProjectWithCopilot(
  userPrompt,
  projectDir,  // ← This is the workspace
  onLog,
  onFileWrite
);
```

### Path Security

The `write_file` tool includes path sanitization to prevent directory traversal attacks:

```javascript
handler: async ({ filePath, content }) => {
  // Prevent "../../../etc/passwd" attacks
  const cleanPath = filePath
    .replace(/^(\.\.[/\\])+/, "")  // Remove leading ../
    .replace(/^[/\\]+/, "");       // Remove leading /

  const fullPath = path.join(workspaceDir, cleanPath);
  
  // Verify path stays within workspace
  if (!fullPath.startsWith(workspaceDir)) {
    throw new Error("Path traversal blocked");
  }
  
  fs.writeFileSync(fullPath, content, "utf8");
};
```

---

## LLM and Model Configuration

### Which LLM Powers This?

The Copilot SDK uses **GitHub's Copilot service** which provides access to multiple LLMs:

| Model | Provider | Notes |
|-------|----------|-------|
| `gpt-4.1` | OpenAI | **Default** - Good balance of quality/speed |
| `gpt-5` | OpenAI | Latest, most capable |
| `claude-sonnet-4.5` | Anthropic | Anthropic's Sonnet model |
| `claude-haiku-4.5` | Anthropic | Faster, lighter Anthropic model |

### How We Configure the Model

```javascript
// In agent_backend.js

const session = await client.createSession({
  model: "gpt-4.1",  // ← Change this to use different models
  streaming: true,
  tools: [fileWriterTool, fileReaderTool, fileListTool],
  systemMessage: {
    content: `You are an expert Python developer...`
  }
});
```

### Can You Use Other LLMs?

**Through GitHub Copilot**: Yes! Change the `model` parameter:

```javascript
// Use GPT-5
const session = await client.createSession({ model: "gpt-5" });

// Use Claude Sonnet
const session = await client.createSession({ model: "claude-sonnet-4.5" });
```

**BYOK (Bring Your Own Key)**: The SDK also supports using your own API keys:

```javascript
// Use your own OpenAI key
const client = new CopilotClient({
  // BYOK configuration - see SDK docs
});
```

### Will the Code Work the Same with Different Models?

**Mostly yes**, but with variations:

- **Tool calling**: All supported models can call the custom tools
- **Code quality**: GPT-5 and Claude Sonnet 4.5 may produce higher quality code
- **Speed**: Claude Haiku is faster but may be less thorough
- **System message adherence**: Different models follow instructions differently

The core architecture (tools, workspace, file writing) works identically regardless of model.

---

## Running the Application

### Prerequisites

1. **Node.js 18+**
2. **Docker Desktop** (for running tests)
3. **GitHub Copilot subscription** (required for SDK usage)
4. **Copilot CLI** installed and authenticated:
   ```bash
   npm install -g @github/copilot
   copilot --version  # Should be 0.0.380+
   ```

### Installation

```bash
cd copilot-hosting-app
npm install
```

### Running

```bash
# Start the server
node server/index.js

# Open in browser
# http://localhost:3000
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |

---

## File Structure

```
copilot-hosting-app/
├── package.json              # Node.js dependencies
├── Dockerfile.runner         # Python Docker image for tests
├── server/
│   ├── index.js              # Express server, SSE streaming
│   ├── agent_backend.js      # Copilot SDK integration, custom tools
│   ├── workspace.js          # File system utilities
│   └── docker_runner.js      # Docker execution for tests
├── ui/
│   └── index.html            # Web UI
└── workspaces/               # Generated projects go here
    └── <project_name>/
        └── ...
```

---

## Summary

This application demonstrates how the **GitHub Copilot SDK** enables you to:

1. **Embed agentic AI** into custom applications
2. **Define custom tools** that the LLM can invoke
3. **Generate complete projects** from natural language
4. **Stream responses** in real-time to users
5. **Access multiple LLMs** (GPT-4.1, GPT-5, Claude) through a unified API

The key insight is that the SDK exposes the **same agent runtime** that powers VS Code's Copilot Agent Mode and the Copilot CLI, but as a **programmable API** you can integrate into any application.
