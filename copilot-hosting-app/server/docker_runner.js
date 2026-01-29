import { spawn, execSync } from "node:child_process";

/**
 * Get the full path to docker executable on Windows
 */
function getDockerPath() {
  if (process.platform === "win32") {
    try {
      // Try to find docker in PATH
      const result = execSync("where docker", { encoding: "utf8" });
      const paths = result.trim().split("\n");
      return paths[0]?.trim() || "docker";
    } catch {
      return "docker";
    }
  }
  return "docker";
}

const dockerPath = getDockerPath();

/**
 * Spawn a process and stream stdout/stderr
 * For docker commands, we avoid shell mode to prevent script mangling on Windows.
 */
function spawnStream(cmd, args, onData, options = {}) {
  return new Promise((resolve) => {
    // Use the full docker path to avoid needing shell mode
    const actualCmd = cmd === "docker" ? dockerPath : cmd;
    // Only use shell if explicitly requested
    const useShell = options.shell ?? false;
    const p = spawn(actualCmd, args, { shell: useShell, ...options });
    let combined = "";

    p.stdout?.on("data", (d) => {
      const s = d.toString();
      combined += s;
      onData?.({ stream: "stdout", text: s });
    });
    
    p.stderr?.on("data", (d) => {
      const s = d.toString();
      combined += s;
      onData?.({ stream: "stderr", text: s });
    });

    p.on("close", (code) => resolve({ code: code ?? 1, combined }));
    p.on("error", (err) => resolve({ code: 1, combined: err.message }));
  });
}

// Track running containers for cleanup
const runningContainers = new Map();

/**
 * Run a command inside the py-runner Docker container
 */
export async function dockerRunCommand({ workspaceHostPath, command, publishPort, onLog, detached = false, containerName = null }) {
  // Convert Windows path to Docker-compatible format
  let dockerPath = workspaceHostPath;
  if (process.platform === "win32") {
    // Convert C:\path\to\dir to /c/path/to/dir for Docker
    dockerPath = workspaceHostPath
      .replace(/\\/g, "/")
      .replace(/^([A-Za-z]):/, (_, letter) => `/${letter.toLowerCase()}`);
  }

  const args = ["run", "--rm"];
  
  if (containerName) {
    args.push("--name", containerName);
  }
  
  args.push("-v", `${dockerPath}:/workspace`, "-w", "/workspace");

  if (publishPort) {
    args.push("-p", `${publishPort.host}:${publishPort.container}`);
  }

  if (detached) {
    args.push("-d");
  }

  args.push("py-runner");
  
  // Add the command
  if (Array.isArray(command)) {
    args.push(...command);
  } else {
    args.push(command);
  }

  const result = await spawnStream("docker", args, onLog);
  
  // If detached and successful, track the container
  if (detached && result.code === 0 && containerName) {
    runningContainers.set(containerName, { 
      path: workspaceHostPath, 
      port: publishPort?.host 
    });
  }
  
  return result;
}

/**
 * Start the generated app in Docker (detached)
 */
export async function startAppInDocker({ workspaceHostPath, deps, startCommand, port, onLog }) {
  const containerName = `copilot-app-${port}`;
  
  // Stop any existing container with this name
  await spawnStream("docker", ["rm", "-f", containerName], null);
  
  // Convert Windows path to Docker-compatible format
  let dockerPath = workspaceHostPath;
  if (process.platform === "win32") {
    dockerPath = workspaceHostPath
      .replace(/\\/g, "/")
      .replace(/^([A-Za-z]):/, (_, letter) => `/${letter.toLowerCase()}`);
  }

  // Build startup script - simplified to avoid shell interpretation issues
  // The script runs inside the container's bash, so we don't use || true or complex redirects
  const startupScript = [
    "pip install --upgrade pip -q",
    `pip install ${deps.join(" ")} -q`,
    `echo 'Starting application on port ${port}...'`,
    startCommand
  ].join(" && ");

  const args = [
    "run", "--rm",
    "--name", containerName,
    "-v", `${dockerPath}:/workspace`,
    "-w", "/workspace",
    "-p", `${port}:8000`,
    "-d",
    "py-runner",
    "bash", "-c", startupScript
  ];

  onLog?.({ stream: "stdout", text: `\n🐳 Starting app in Docker container: ${containerName}\n` });
  
  const result = await spawnStream("docker", args, null);
  
  if (result.code === 0) {
    const containerId = result.combined.trim().slice(0, 12);
    runningContainers.set(containerName, { 
      id: containerId,
      path: workspaceHostPath, 
      port 
    });
    
    // Wait a moment for the app to start
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check if container is still running
    const checkResult = await spawnStream("docker", ["ps", "-q", "-f", `name=${containerName}`], null);
    if (checkResult.combined.trim()) {
      onLog?.({ stream: "stdout", text: `✅ Container started successfully!\n` });
      return { success: true, containerId, containerName, port, url: `http://localhost:${port}` };
    } else {
      // Container exited - get logs
      const logsResult = await spawnStream("docker", ["logs", containerName], null);
      onLog?.({ stream: "stderr", text: `Container exited. Logs:\n${logsResult.combined}\n` });
      return { success: false, error: "Container exited unexpectedly", logs: logsResult.combined };
    }
  }
  
  return { success: false, error: result.combined };
}

/**
 * Stop a running app container
 */
export async function stopAppContainer(containerName) {
  const result = await spawnStream("docker", ["rm", "-f", containerName], null);
  runningContainers.delete(containerName);
  return result.code === 0;
}

/**
 * Get list of running app containers
 */
export function getRunningContainers() {
  return Array.from(runningContainers.entries()).map(([name, info]) => ({
    name,
    ...info
  }));
}

/**
 * Check if Docker is available and running
 */
export async function checkDocker() {
  const result = await spawnStream("docker", ["info"], null);
  return result.code === 0;
}

/**
 * Build the py-runner image if it doesn't exist
 */
export async function ensureRunnerImage(projectRoot, onLog) {
  // Check if image exists
  const checkResult = await spawnStream("docker", ["images", "-q", "py-runner"], null);
  if (checkResult.combined.trim()) {
    return true; // Image exists
  }

  // Build the image
  onLog?.({ stream: "stdout", text: "Building py-runner Docker image...\n" });
  const buildResult = await spawnStream(
    "docker",
    ["build", "-t", "py-runner", "-f", "Dockerfile.runner", "."],
    onLog,
    { cwd: projectRoot }
  );
  
  return buildResult.code === 0;
}
