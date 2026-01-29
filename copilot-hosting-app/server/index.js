/**
 * Multi-Step Generation Server
 * 
 * Express server with orchestration-based generation API.
 * Supports phase-by-phase generation with user confirmation.
 */

import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createOrchestrator, ARCHETYPES } from "./orchestrator.js";
import { checkDocker, ensureRunnerImage, dockerRunCommand, startAppInDocker } from "./docker_runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const WORKSPACES = path.join(ROOT, "workspaces");
const UI_DIR = path.join(ROOT, "ui");

// Ensure workspaces directory exists
if (!fs.existsSync(WORKSPACES)) {
  fs.mkdirSync(WORKSPACES, { recursive: true });
}

const app = express();
app.use(express.json({ limit: "10mb" }));

// Serve the multi-step UI
app.get("/", (req, res) => {
  res.sendFile(path.join(UI_DIR, "index.html"));
});

// Serve static files
app.use(express.static(UI_DIR));

// Store active jobs and orchestrators
const activeJobs = new Map();
let nextAppPort = 8100;

/**
 * SSE helper functions
 */
function sseInit(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
}

function sseSend(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Generate a project name from the prompt
 */
function generateProjectName(prompt, jobId) {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 3);
  
  const base = words.length > 0 ? words.join("_") : "project";
  return `${base}_app`;
}

/**
 * API: Get available archetypes
 */
app.get("/api/archetypes", (req, res) => {
  const archetypes = Object.entries(ARCHETYPES).map(([id, arch]) => ({
    id,
    name: arch.name,
    description: arch.description,
    stack: arch.stack,
  }));
  res.json(archetypes);
});

/**
 * API: Create a new generation job
 */
app.post("/api/generate", async (req, res) => {
  const { prompt, archetype, attachment } = req.body;

  if (!prompt?.trim()) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  if (!archetype) {
    return res.status(400).json({ error: "Archetype is required" });
  }

  // Generate job ID and project name
  const jobId = Math.random().toString(36).substring(2, 10);
  const projectName = generateProjectName(prompt, jobId);
  const projectDir = path.join(WORKSPACES, projectName);

  // Clean up existing directory if present
  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
  fs.mkdirSync(projectDir, { recursive: true });

  // Create orchestrator
  const job = {
    id: jobId,
    prompt,
    archetype,
    attachment,
    projectDir,
    status: "initializing",
    listeners: new Set(),
    events: [],
    orchestrator: null,
  };

  activeJobs.set(jobId, job);

  res.json({ jobId, projectDir });
});

/**
 * API: Connect to SSE stream for a job
 */
app.get("/api/generate/stream", async (req, res) => {
  const jobId = req.query.jobId;
  const job = activeJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  sseInit(res);

  // Send any events that already happened
  for (const evt of job.events) {
    sseSend(res, evt.type, evt.data);
  }

  // Add listener
  job.listeners.add(res);

  // Clean up on disconnect
  req.on("close", () => {
    job.listeners.delete(res);
  });

  // If job hasn't started yet, start the orchestrator
  if (job.status === "initializing") {
    startOrchestration(jobId);
  }
});

/**
 * Start the orchestration process
 */
async function startOrchestration(jobId) {
  const job = activeJobs.get(jobId);
  if (!job) return;

  job.status = "running";

  // Create orchestrator with event emitter
  const orchestrator = createOrchestrator(job.projectDir, (event) => {
    broadcastEvent(jobId, event.type, event.data);
  });

  job.orchestrator = orchestrator;

  // Check Docker
  broadcastEvent(jobId, "status", { message: "Checking Docker..." });
  const dockerOk = await checkDocker();
  if (!dockerOk) {
    broadcastEvent(jobId, "error", { message: "Docker is not running. Please start Docker Desktop." });
    return;
  }

  // Ensure runner image
  broadcastEvent(jobId, "status", { message: "Ensuring Docker runner image..." });
  const imageOk = await ensureRunnerImage(ROOT, (log) => {
    broadcastEvent(jobId, "log", log);
  });
  if (!imageOk) {
    broadcastEvent(jobId, "error", { message: "Failed to build Docker runner image." });
    return;
  }

  // Save attachment if present
  if (job.attachment && job.attachment.content) {
    const specPath = path.join(job.projectDir, `_spec_${job.attachment.name}`);
    fs.writeFileSync(specPath, job.attachment.content, "utf8");
  }

  // Select archetype and get phases
  try {
    await orchestrator.selectArchetype(job.archetype, job.prompt, job.attachment);
    
    // Propose the first phase
    await orchestrator.proposeNextPhase();
  } catch (error) {
    broadcastEvent(jobId, "error", { message: error.message });
  }
}

/**
 * Broadcast event to all listeners
 */
function broadcastEvent(jobId, type, data) {
  const job = activeJobs.get(jobId);
  if (!job) return;

  // Store event
  job.events.push({ type, data });

  // Send to all listeners
  for (const res of job.listeners) {
    sseSend(res, type, data);
  }
}

/**
 * API: Confirm a phase (proceed with generation)
 */
app.post("/api/generate/:jobId/confirm", async (req, res) => {
  const { jobId } = req.params;
  const { phaseIndex } = req.body;
  const job = activeJobs.get(jobId);

  if (!job || !job.orchestrator) {
    return res.status(404).json({ error: "Job not found" });
  }

  try {
    await job.orchestrator.confirmPhase(phaseIndex);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * API: Skip a phase (only for optional phases)
 */
app.post("/api/generate/:jobId/skip", async (req, res) => {
  const { jobId } = req.params;
  const { phaseIndex } = req.body;
  const job = activeJobs.get(jobId);

  if (!job || !job.orchestrator) {
    return res.status(404).json({ error: "Job not found" });
  }

  try {
    await job.orchestrator.skipPhase(phaseIndex);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * API: Get job status
 */
app.get("/api/generate/:jobId/status", (req, res) => {
  const { jobId } = req.params;
  const job = activeJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json({
    id: jobId,
    status: job.status,
    projectDir: job.projectDir,
    phases: job.orchestrator?.getState().phases || [],
  });
});

/**
 * API: Run tests for a completed job
 */
app.post("/api/generate/:jobId/test", async (req, res) => {
  const { jobId } = req.params;
  const job = activeJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  broadcastEvent(jobId, "status", { message: "Running tests..." });

  try {
    // Read requirements.txt for dependencies
    const reqPath = path.join(job.projectDir, "requirements.txt");
    let deps = ["fastapi", "uvicorn", "pytest", "httpx"];
    if (fs.existsSync(reqPath)) {
      const content = fs.readFileSync(reqPath, "utf8");
      deps = content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
        .map((l) => l.split(/[=<>]/)[0].trim())
        .filter(Boolean);
    }

    const bootstrapScript = `set -e; pip install -q ${deps.join(" ")}; pytest -v`;

    const result = await dockerRunCommand({
      workspaceHostPath: job.projectDir,
      command: ["bash", "-c", bootstrapScript],
      onLog: (x) => broadcastEvent(jobId, "log", x),
    });

    if (result.code === 0) {
      broadcastEvent(jobId, "status", { message: "Tests passed!" });
      res.json({ success: true, output: result.combined });
    } else {
      broadcastEvent(jobId, "status", { message: "Tests failed." });
      res.json({ success: false, output: result.combined });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * API: Deploy a completed job
 */
app.post("/api/generate/:jobId/deploy", async (req, res) => {
  const { jobId } = req.params;
  const job = activeJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  broadcastEvent(jobId, "status", { message: "Deploying to Docker..." });

  try {
    // Read requirements.txt for dependencies
    const reqPath = path.join(job.projectDir, "requirements.txt");
    let deps = ["fastapi", "uvicorn"];
    if (fs.existsSync(reqPath)) {
      const content = fs.readFileSync(reqPath, "utf8");
      deps = content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
        .map((l) => l.split(/[=<>]/)[0].trim())
        .filter(Boolean);
    }

    const port = nextAppPort++;
    const result = await startAppInDocker({
      workspaceHostPath: job.projectDir,
      deps,
      startCommand: "uvicorn app.main:app --host 0.0.0.0 --port 8000",
      port,
      onLog: (x) => broadcastEvent(jobId, "log", x),
    });

    if (result.success) {
      broadcastEvent(jobId, "completed", {
        url: result.url,
        workspace: job.projectDir,
        container: result.containerName,
      });
      res.json(result);
    } else {
      broadcastEvent(jobId, "error", { message: result.error });
      res.json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Multi-Step App Generator running at http://localhost:${PORT}\n`);
  console.log(`📂 Workspaces directory: ${WORKSPACES}`);
  console.log(`\nOpen http://localhost:${PORT} in your browser to start generating apps!\n`);
});
