import { spawn } from "node:child_process";

/**
 * Spawn a process and stream stdout/stderr
 */
function spawnStream(cmd, args, onData, options = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { shell: true, ...options });
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

/**
 * Run a command inside the py-runner Docker container
 */
export async function dockerRunCommand({ workspaceHostPath, command, publishPort, onLog, detached = false }) {
  // Convert Windows path to Docker-compatible format
  let dockerPath = workspaceHostPath;
  if (process.platform === "win32") {
    // Convert C:\path\to\dir to /c/path/to/dir for Docker
    dockerPath = workspaceHostPath
      .replace(/\\/g, "/")
      .replace(/^([A-Za-z]):/, (_, letter) => `/${letter.toLowerCase()}`);
  }

  const args = [
    "run", "--rm",
    "-v", `${dockerPath}:/workspace`,
    "-w", "/workspace"
  ];

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

  return await spawnStream("docker", args, onLog);
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
