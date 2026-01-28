import { CopilotClient, defineTool } from "@github/copilot-sdk";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * GitHub Copilot SDK-based agent backend.
 * Uses the official @github/copilot-sdk to generate code.
 */

let copilotClient = null;

/**
 * Get or create a Copilot client
 */
async function getClient() {
  if (!copilotClient) {
    copilotClient = new CopilotClient({
      useStdio: true,  // Use stdio transport instead of TCP server
      logLevel: "info",
    });
    await copilotClient.start();
  }
  return copilotClient;
}

/**
 * Stop the Copilot client
 */
export async function stopClient() {
  if (copilotClient) {
    await copilotClient.stop();
    copilotClient = null;
  }
}

/**
 * Create a tool for writing files to the workspace
 */
function createFileWriterTool(workspaceDir, onFileWrite) {
  return defineTool("write_file", {
    description: "Write content to a file in the project workspace. Use this to create Python files, tests, configuration files, etc.",
    parameters: {
      type: "object",
      properties: {
        filePath: { 
          type: "string", 
          description: "Relative path to the file (e.g., 'app/main.py', 'tests/test_main.py', 'requirements.txt')" 
        },
        content: { 
          type: "string", 
          description: "The full content to write to the file" 
        },
      },
      required: ["filePath", "content"],
    },
    handler: async (args) => {
      const { filePath, content } = args;
      
      // Sanitize the path to prevent directory traversal
      const cleanPath = filePath.replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
      const fullPath = path.join(workspaceDir, cleanPath);
      
      // Ensure the directory exists
      const dir = path.dirname(fullPath);
      fs.mkdirSync(dir, { recursive: true });
      
      // Write the file
      fs.writeFileSync(fullPath, content, "utf8");
      
      // Notify about file creation
      onFileWrite?.({ path: cleanPath, action: "created" });
      
      return { success: true, path: cleanPath, message: `File ${cleanPath} written successfully` };
    },
  });
}

/**
 * Create a tool for reading files from the workspace
 */
function createFileReaderTool(workspaceDir) {
  return defineTool("read_file", {
    description: "Read the content of a file from the project workspace",
    parameters: {
      type: "object",
      properties: {
        filePath: { 
          type: "string", 
          description: "Relative path to the file to read" 
        },
      },
      required: ["filePath"],
    },
    handler: async (args) => {
      const { filePath } = args;
      const cleanPath = filePath.replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
      const fullPath = path.join(workspaceDir, cleanPath);
      
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `File ${cleanPath} not found` };
      }
      
      const content = fs.readFileSync(fullPath, "utf8");
      return { success: true, path: cleanPath, content };
    },
  });
}

/**
 * Create a tool for listing files in the workspace
 */
function createFileListTool(workspaceDir) {
  return defineTool("list_files", {
    description: "List all files in the project workspace",
    parameters: {
      type: "object",
      properties: {
        directory: { 
          type: "string", 
          description: "Optional subdirectory to list (defaults to root)" 
        },
      },
      required: [],
    },
    handler: async (args) => {
      const { directory = "" } = args;
      const targetDir = path.join(workspaceDir, directory);
      
      if (!fs.existsSync(targetDir)) {
        return { success: false, error: `Directory ${directory || "root"} not found` };
      }
      
      const files = [];
      function listRecursive(dir, prefix = "") {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            if (!["__pycache__", ".venv", ".git", "node_modules"].includes(entry.name)) {
              listRecursive(path.join(dir, entry.name), relPath);
            }
          } else {
            files.push(relPath);
          }
        }
      }
      
      listRecursive(targetDir);
      return { success: true, files };
    },
  });
}

/**
 * Generate a complete Python/FastAPI project using GitHub Copilot SDK
 */
export async function generateProjectWithCopilot(userPrompt, workspaceDir, onLog, onFileWrite) {
  const client = await getClient();
  
  // Create tools that allow Copilot to write files
  const fileWriterTool = createFileWriterTool(workspaceDir, onFileWrite);
  const fileReaderTool = createFileReaderTool(workspaceDir);
  const fileListTool = createFileListTool(workspaceDir);
  
  onLog?.("🤖 Starting Copilot SDK session...\n");
  
  // Create a session with streaming and tools
  const session = await client.createSession({
    model: "gpt-4.1",
    streaming: true,
    tools: [fileWriterTool, fileReaderTool, fileListTool],
    systemMessage: {
      content: `You are an expert Python developer specialized in building FastAPI applications.
Your task is to generate a complete, working Python project based on the user's requirements.

IMPORTANT INSTRUCTIONS:
1. Use the write_file tool to create each file in the project
2. Create a well-structured project with:
   - README.md with documentation
   - requirements.txt with dependencies
   - app/__init__.py (empty)
   - app/main.py with FastAPI application
   - tests/__init__.py (empty)
   - tests/test_main.py with pytest tests

3. The FastAPI app should:
   - Use Pydantic models for request/response schemas
   - Include proper type hints
   - Use in-memory storage (dict) for simplicity
   - Implement full CRUD operations
   - Return appropriate HTTP status codes

4. Tests should:
   - Use pytest with FastAPI's TestClient
   - Cover all endpoints
   - Include at least 5-7 test cases
   - Use fixtures for setup/teardown

5. Dependencies should include: fastapi, uvicorn, pydantic, pytest, httpx

After creating all files, provide a brief summary of what was created.`
    }
  });

  let responseContent = "";
  
  // Set up event listener for streaming
  session.on((event) => {
    if (event.type === "assistant.message_delta") {
      responseContent += event.data.deltaContent;
      onLog?.(event.data.deltaContent);
    }
    if (event.type === "tool.call") {
      onLog?.(`\n🔧 Calling tool: ${event.data.name}\n`);
    }
    if (event.type === "tool.result") {
      onLog?.(`✅ Tool completed\n`);
    }
  });

  // Send the prompt and wait for completion
  const prompt = `Create a complete Python FastAPI project based on this requirement:

${userPrompt}

Use the write_file tool to create each file. Make sure to create all necessary files for a working application with tests.`;

  try {
    await session.sendAndWait({ prompt });
    
    // Return project info
    return {
      project_name: path.basename(workspaceDir),
      response: responseContent,
      run: {
        deps: ["fastapi", "uvicorn", "pydantic", "pytest", "httpx"],
        test_command: "pytest -v",
        start_command: "uvicorn app.main:app --host 0.0.0.0 --port 8000"
      }
    };
  } catch (error) {
    throw new Error(`Copilot SDK error: ${error.message}`);
  }
}

/**
 * Fix code issues using GitHub Copilot SDK
 */
export async function fixCodeWithCopilot(userPrompt, workspaceDir, errorLogs, onLog, onFileWrite) {
  const client = await getClient();
  
  const fileWriterTool = createFileWriterTool(workspaceDir, onFileWrite);
  const fileReaderTool = createFileReaderTool(workspaceDir);
  const fileListTool = createFileListTool(workspaceDir);
  
  onLog?.("🔧 Starting Copilot SDK fix session...\n");
  
  const session = await client.createSession({
    model: "gpt-4.1",
    streaming: true,
    tools: [fileWriterTool, fileReaderTool, fileListTool],
    systemMessage: {
      content: `You are an expert Python developer debugging a FastAPI application.
Your task is to fix code issues based on error logs.

INSTRUCTIONS:
1. First, use list_files to see what files exist
2. Use read_file to examine the problematic files
3. Analyze the error logs to understand what's wrong
4. Use write_file to fix the issues (write the COMPLETE fixed file content)
5. Explain what you fixed`
    }
  });

  let responseContent = "";
  
  session.on((event) => {
    if (event.type === "assistant.message_delta") {
      responseContent += event.data.deltaContent;
      onLog?.(event.data.deltaContent);
    }
    if (event.type === "tool.call") {
      onLog?.(`\n🔧 Calling tool: ${event.data.name}\n`);
    }
  });

  const prompt = `The following code has errors. Please fix them.

Original requirement: ${userPrompt}

Error logs:
\`\`\`
${errorLogs.slice(0, 8000)}
\`\`\`

Use the tools to read the current files, identify the issues, and write the fixed versions.`;

  try {
    await session.sendAndWait({ prompt });
    return { success: true, response: responseContent };
  } catch (error) {
    throw new Error(`Copilot SDK error: ${error.message}`);
  }
}

/**
 * Check if the Copilot CLI is available
 */
export async function checkCopilotCLI() {
  return new Promise((resolve) => {
    const proc = spawn("copilot", ["--version"], { shell: true });
    let output = "";
    proc.stdout?.on("data", (d) => { output += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, version: output.trim() });
      } else {
        resolve({ ok: false, message: "Copilot CLI not found. Install it from: https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli" });
      }
    });
    proc.on("error", () => {
      resolve({ ok: false, message: "Copilot CLI not found" });
    });
  });
}
