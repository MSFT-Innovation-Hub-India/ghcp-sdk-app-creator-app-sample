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
  onTrace,
}) {
  const client = await getClient();

  onLog?.(`\n🔧 Starting phase: ${phase.name}\n`);
  onTrace?.(`Initializing Copilot session for phase: ${phase.name}`, 'info');

  let responseContent = "";
  const generatedFiles = [];

  // Track file writes - wrap the callback to collect files
  const trackingFileWrite = (file) => {
    generatedFiles.push(file.path);
    onFileWrite?.(file);
    onTrace?.(`File written: ${file.path}`, 'success');
  };

  // Create tools with tracking enabled from the start
  const fileWriterTool = createFileWriterTool(workspaceDir, trackingFileWrite);
  const fileReaderTool = createFileReaderTool(workspaceDir);
  const fileListTool = createFileListTool(workspaceDir);

  // Create session
  const session = await client.createSession({
    model: "gpt-4.1",
    streaming: true,
    tools: [fileWriterTool, fileReaderTool, fileListTool],
    systemMessage: {
      content: buildSystemMessage(phase, archetype),
    },
    timeout: 300000, // 5 minutes per phase
  });

  onTrace?.(`Session created with model: gpt-4.1`, 'debug');

  // Set up event listeners
  session.on((event) => {
    if (event.type === "assistant.message_delta") {
      responseContent += event.data.deltaContent;
      onLog?.(event.data.deltaContent);
    }
    if (event.type === "tool.call") {
      onLog?.(`\n📄 [${event.data.name}] `);
      onTrace?.(`Tool call: ${event.data.name}`, 'info');
    }
    if (event.type === "tool.result") {
      onTrace?.(`Tool result received`, 'debug');
    }
    if (event.type === "stream.start") {
      onTrace?.(`Stream started`, 'debug');
    }
    if (event.type === "stream.end") {
      onTrace?.(`Stream ended`, 'debug');
    }
    if (event.type === "error") {
      onTrace?.(`Error: ${event.data?.message || 'Unknown error'}`, 'error');
    }
  });

  try {
    onTrace?.(`Sending prompt to Copilot SDK...`, 'info');
    // 5 minute timeout for complex phases
    await session.sendAndWait({ prompt }, 300000);
    onTrace?.(`Copilot response complete`, 'success');

    // Deduplicate files
    const uniqueFiles = [...new Set(generatedFiles)];
    onTrace?.(`Phase complete: ${uniqueFiles.length} files generated`, 'success');

    return {
      success: true,
      files: uniqueFiles,
      summary: responseContent,
    };
  } catch (error) {
    // If timeout, return partial results if we have any files
    if (error.message?.includes('Timeout') && generatedFiles.length > 0) {
      onLog?.(`\n⚠️ Phase timed out but ${generatedFiles.length} files were created\n`);
      onTrace?.(`Phase timed out with ${generatedFiles.length} files created`, 'warn');
      
      const uniqueFiles = [...new Set(generatedFiles)];
      return {
        success: true,
        partial: true,
        files: uniqueFiles,
        summary: responseContent || "Phase completed with partial results due to timeout",
      };
    }
    
    onLog?.(`\n❌ Phase failed: ${error.message}\n`);
    onTrace?.(`Phase failed: ${error.message}`, 'error');
    throw error;
  }
}
