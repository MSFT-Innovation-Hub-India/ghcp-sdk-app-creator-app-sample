import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { nanoid } from "nanoid";
import { ensureDir, writeFile, listFiles } from "./workspace.js";
import { dockerRunCommand, checkDocker, ensureRunnerImage } from "./docker_runner.js";
import { generateProjectWithCopilot, fixCodeWithCopilot, checkCopilotCLI, stopClient } from "./agent_backend.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "5mb" }));

const ROOT = path.resolve(__dirname, "..");
const WORKSPACES = path.join(ROOT, "workspaces");
ensureDir(WORKSPACES);

// Serve the UI
app.get("/", (req, res) => {
  const html = fs.readFileSync(path.join(ROOT, "ui", "index.html"), "utf8");
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.send(html);
});

// Health check endpoint
app.get("/health", async (req, res) => {
  const dockerOk = await checkDocker();
  const copilotCheck = await checkCopilotCLI();
  
  res.json({
    status: dockerOk && copilotCheck.ok ? "healthy" : "degraded",
    docker: dockerOk,
    copilot: copilotCheck
  });
});

// SSE helpers
function sseInit(res) {
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");
  res.flushHeaders?.();
}

function sseSend(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Generate a project name from the user prompt
function generateProjectName(prompt, jobId) {
  const words = prompt.toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 2 && !["create", "build", "make", "fastapi", "python", "app", "with", "that", "and", "the", "for", "using"].includes(w))
    .slice(0, 3);
  
  return words.length > 0 ? words.join("_") + "_app" : `copilot_app_${jobId}`;
}

// Main generation endpoint
app.get("/generate", async (req, res) => {
  sseInit(res);

  const userPrompt = (req.query.prompt || "").toString().trim();
  if (!userPrompt) {
    sseSend(res, "error", { message: "Missing ?prompt= parameter" });
    return res.end();
  }

  const jobId = nanoid(8);
  console.log(`[${jobId}] Starting generation for prompt: ${userPrompt.slice(0, 50)}...`);

  // Check prerequisites
  sseSend(res, "status", { jobId, message: "Checking prerequisites..." });

  const dockerOk = await checkDocker();
  if (!dockerOk) {
    sseSend(res, "error", { message: "Docker is not running. Please start Docker Desktop and try again." });
    return res.end();
  }

  // Ensure runner image exists
  sseSend(res, "status", { jobId, message: "Ensuring Docker runner image exists..." });
  const imageOk = await ensureRunnerImage(ROOT, (log) => {
    sseSend(res, "run_log", log);
  });
  if (!imageOk) {
    sseSend(res, "error", { message: "Failed to build Docker runner image. Check Dockerfile.runner" });
    return res.end();
  }

  // Create workspace directory first (SDK will write files into it)
  const projectName = generateProjectName(userPrompt, jobId);
  const projectDir = path.join(WORKSPACES, projectName);
  ensureDir(projectDir);

  // Generate project using GitHub Copilot SDK
  sseSend(res, "status", { jobId, message: "Generating project with GitHub Copilot SDK..." });

  let project;
  try {
    project = await generateProjectWithCopilot(
      userPrompt,
      projectDir,
      (t) => sseSend(res, "agent_log", { text: t }),
      (fileInfo) => sseSend(res, "file", fileInfo)
    );
  } catch (e) {
    sseSend(res, "error", { message: `Generation failed: ${e.message}`, workspace: projectDir });
    return res.end();
  }

  // Run tests with auto-fix loop
  const maxFixes = 3;
  let attempt = 0;
  let lastLogs = "";

  while (attempt <= maxFixes) {
    sseSend(res, "status", { jobId, message: `Running tests (attempt ${attempt + 1}/${maxFixes + 1})...` });

    const deps = (project.run?.deps || ["fastapi", "uvicorn", "pytest", "httpx"]).join(" ");
    const testCmd = project.run?.test_command || "pytest -v";

    // Bootstrap script: create venv, install deps, run tests
    const bootstrapScript = `
set -e
python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip -q
pip install ${deps} -q
echo "\\n=== Running Tests ==="
${testCmd}
`.trim();

    const testResult = await dockerRunCommand({
      workspaceHostPath: projectDir,
      command: ["bash", "-c", bootstrapScript],
      onLog: (x) => sseSend(res, "run_log", x)
    });

    lastLogs = testResult.combined;

    if (testResult.code === 0) {
      // Tests passed! Start the app
      sseSend(res, "status", { jobId, message: "Tests passed! Starting application..." });

      const hostPort = 8090 + Math.floor(Math.random() * 100); // Random port to avoid conflicts
      const startCmd = project.run?.start_command || "uvicorn app.main:app --host 0.0.0.0 --port 8000";

      // For the demo, we'll just report success with the workspace path
      // In a production setup, you'd start the container in detached mode
      sseSend(res, "agent_log", { text: `\n✅ Project ready to run!\n` });
      sseSend(res, "agent_log", { text: `\n📂 Workspace: ${projectDir}\n` });
      sseSend(res, "agent_log", { text: `\n🚀 To start the app:\n` });
      sseSend(res, "agent_log", { text: `   cd ${projectDir}\n` });
      sseSend(res, "agent_log", { text: `   python -m venv .venv\n` });
      sseSend(res, "agent_log", { text: `   source .venv/bin/activate  # or .venv\\Scripts\\activate on Windows\n` });
      sseSend(res, "agent_log", { text: `   pip install -r requirements.txt\n` });
      sseSend(res, "agent_log", { text: `   ${startCmd}\n` });

      sseSend(res, "done", { 
        url: `http://localhost:8000 (after running manually)`,
        workspace: projectDir,
        files: listFiles(projectDir)
      });
      return res.end();
    }

    // Tests failed
    if (attempt === maxFixes) {
      sseSend(res, "error", { 
        message: "Tests failed after maximum fix attempts. Check the logs for details.",
        workspace: projectDir 
      });
      return res.end();
    }

    // Use Copilot SDK to fix the errors
    sseSend(res, "status", { jobId, message: "Tests failed. Using Copilot SDK to fix..." });

    try {
      await fixCodeWithCopilot(
        userPrompt,
        projectDir,
        lastLogs,
        (t) => sseSend(res, "agent_log", { text: t }),
        (fileInfo) => sseSend(res, "file", { ...fileInfo, action: "patched" })
      );
    } catch (fixError) {
      sseSend(res, "agent_log", { text: `\n⚠️ Auto-fix failed: ${fixError.message}\n` });
    }

    attempt += 1;
  }
});

// List all generated workspaces
app.get("/workspaces", (req, res) => {
  try {
    const workspaces = fs.readdirSync(WORKSPACES, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => ({
        name: d.name,
        path: path.join(WORKSPACES, d.name),
        files: listFiles(path.join(WORKSPACES, d.name))
      }));
    res.json(workspaces);
  } catch (e) {
    res.json([]);
  }
});

// Get files from a specific workspace
app.get("/workspaces/:name/files", (req, res) => {
  const workspacePath = path.join(WORKSPACES, req.params.name);
  if (!fs.existsSync(workspacePath)) {
    return res.status(404).json({ error: "Workspace not found" });
  }
  
  const files = listFiles(workspacePath);
  res.json({ files });
});

// Get content of a specific file
app.get("/workspaces/:name/file", (req, res) => {
  const workspacePath = path.join(WORKSPACES, req.params.name);
  const filePath = req.query.path || "";
  const fullPath = path.join(workspacePath, filePath);
  
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: "File not found" });
  }
  
  try {
    const content = fs.readFileSync(fullPath, "utf8");
    res.type("text/plain").send(content);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const server = app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  GitHub Copilot SDK - Python App Factory                   ║
╠════════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${PORT}                  ║
║  Workspaces folder: ${WORKSPACES.slice(-40).padStart(40)}  ║
╚════════════════════════════════════════════════════════════╝
`);
});

server.on('error', (err) => {
  console.error('Server error:', err);
});
