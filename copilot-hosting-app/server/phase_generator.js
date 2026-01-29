/**
 * Phase Generator
 * 
 * Handles generating files for a single phase using the Copilot SDK.
 * This module is called by the Orchestrator for each phase.
 */

import { CopilotClient, defineTool } from "@github/copilot-sdk";
import fs from "node:fs";
import path from "node:path";

// Shared Copilot client instance
let copilotClient = null;

/**
 * Get or create a Copilot client
 */
async function getClient() {
  if (!copilotClient) {
    copilotClient = new CopilotClient({
      useStdio: true,
      logLevel: "info",
      timeout: 300000,
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
 * Create the write_file tool
 */
function createFileWriterTool(workspaceDir, onFileWrite) {
  return defineTool("write_file", {
    description: "Write content to a file in the project workspace. Use this to create Python files, tests, configuration files, etc.",
    parameters: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Relative path to the file (e.g., 'app/main.py', 'tests/test_main.py', 'requirements.txt')",
        },
        content: {
          type: "string",
          description: "The full content to write to the file",
        },
      },
      required: ["filePath", "content"],
    },
    handler: async (args) => {
      const { filePath, content } = args;

      // Sanitize the path
      const cleanPath = filePath.replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
      const fullPath = path.join(workspaceDir, cleanPath);

      // Ensure directory exists
      const dir = path.dirname(fullPath);
      fs.mkdirSync(dir, { recursive: true });

      // Post-process content to fix common issues
      let fixedContent = content;
      
      // Fix Pydantic v1 -> v2 syntax
      fixedContent = fixedContent.replace(/constr\(([^)]*)\bregex=/g, "constr($1pattern=");
      fixedContent = fixedContent.replace(/Field\(([^)]*)\bregex=/g, "Field($1pattern=");

      // Write the file
      fs.writeFileSync(fullPath, fixedContent, "utf8");

      onFileWrite?.({ path: cleanPath, action: "created" });

      return { success: true, path: cleanPath, message: `File ${cleanPath} written successfully` };
    },
  });
}

/**
 * Create the read_file tool
 */
function createFileReaderTool(workspaceDir) {
  return defineTool("read_file", {
    description: "Read the content of a file from the project workspace",
    parameters: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Relative path to the file to read",
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
 * Create the list_files tool
 */
function createFileListTool(workspaceDir) {
  return defineTool("list_files", {
    description: "List all files in the project workspace",
    parameters: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Optional subdirectory to list (defaults to root)",
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
 * Build the system message for phase generation
 */
function buildSystemMessage(phase, archetype) {
  return `You are an expert software developer generating code for a specific phase of a project.

CURRENT PHASE: ${phase.name}
ARCHETYPE: ${archetype}

CRITICAL RULES:
1. Use the write_file tool to create EACH file - do not just describe files
2. For Python projects:
   - Use Pydantic v2 syntax: 'pattern=' instead of 'regex=' in constr() and Field()
   - Include 'python-multipart' in requirements.txt if using form data
   - Include 'email-validator' if using EmailStr
3. Create ONLY the files needed for THIS phase
4. Reference existing files from previous phases correctly
5. Include all necessary imports
6. Write complete, working code - no placeholders or TODOs
7. After creating files, provide a brief summary of what was created

Focus ONLY on the current phase. Do not regenerate files from previous phases.`;
}

/**
 * Generate files for a single phase
 */
export async function generatePhaseWithCopilot({
  prompt,
  workspaceDir,
  phase,
  archetype,
  previousPhases,
  userPrompt,
  attachment,
  onLog,
  onFileWrite,
}) {
  const client = await getClient();

  // Create tools
  const fileWriterTool = createFileWriterTool(workspaceDir, onFileWrite);
  const fileReaderTool = createFileReaderTool(workspaceDir);
  const fileListTool = createFileListTool(workspaceDir);

  onLog?.(`\n🔧 Starting phase: ${phase.name}\n`);

  // Create session
  const session = await client.createSession({
    model: "gpt-4.1",
    streaming: true,
    tools: [fileWriterTool, fileReaderTool, fileListTool],
    systemMessage: {
      content: buildSystemMessage(phase, archetype),
    },
    timeout: 180000, // 3 minutes per phase
  });

  let responseContent = "";
  const generatedFiles = [];

  // Track file writes
  const originalOnFileWrite = onFileWrite;
  const trackingFileWrite = (file) => {
    generatedFiles.push(file.path);
    originalOnFileWrite?.(file);
  };

  // Update the tool with tracking
  session.tools = [
    createFileWriterTool(workspaceDir, trackingFileWrite),
    fileReaderTool,
    fileListTool,
  ];

  // Set up event listeners
  session.on((event) => {
    if (event.type === "assistant.message_delta") {
      responseContent += event.data.deltaContent;
      onLog?.(event.data.deltaContent);
    }
    if (event.type === "tool.call") {
      onLog?.(`\n📄 [${event.data.name}] `);
    }
    if (event.type === "tool.result") {
      // Extract file path from result if it's a write_file call
      try {
        const result = JSON.parse(event.data.result);
        if (result.path) {
          generatedFiles.push(result.path);
          onLog?.(`created: ${result.path}\n`);
        }
      } catch {
        // Ignore parse errors
      }
    }
  });

  try {
    await session.sendAndWait({ prompt }, 180000); // 3 minute timeout

    // Deduplicate files
    const uniqueFiles = [...new Set(generatedFiles)];

    return {
      success: true,
      files: uniqueFiles,
      summary: responseContent,
    };
  } catch (error) {
    onLog?.(`\n❌ Phase failed: ${error.message}\n`);
    throw error;
  }
}
