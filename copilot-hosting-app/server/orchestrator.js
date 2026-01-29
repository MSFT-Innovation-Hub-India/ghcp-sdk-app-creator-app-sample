/**
 * Multi-Step Orchestration Engine
 * 
 * Manages the generation process in phases with user confirmation between each step.
 * Supports multiple application archetypes (FastAPI, React+FastAPI, Node.js, etc.)
 */

import { generatePhaseWithCopilot } from "./phase_generator.js";
import fs from "node:fs";
import path from "node:path";

/**
 * Available application archetypes
 */
export const ARCHETYPES = {
  "fastapi-sqlite": {
    name: "FastAPI + SQLite Backend",
    description: "Python REST API with SQLite database, JWT authentication, and comprehensive tests",
    stack: ["Python", "FastAPI", "SQLite", "Pydantic", "SQLAlchemy", "pytest"],
    phases: [
      {
        id: "setup",
        name: "Project Setup",
        description: "Create requirements.txt, README.md, and project structure",
        files: ["requirements.txt", "README.md", "app/__init__.py", "tests/__init__.py"],
      },
      {
        id: "database",
        name: "Database Layer",
        description: "SQLAlchemy models and database configuration",
        files: ["app/database.py", "app/models.py"],
      },
      {
        id: "schemas",
        name: "API Schemas",
        description: "Pydantic schemas for request/response validation",
        files: ["app/schemas.py"],
      },
      {
        id: "auth",
        name: "Authentication",
        description: "JWT-based authentication with password hashing",
        files: ["app/auth.py"],
        optional: true,
      },
      {
        id: "crud",
        name: "CRUD Operations",
        description: "Database operations for all models",
        files: ["app/crud.py"],
      },
      {
        id: "api",
        name: "API Endpoints",
        description: "FastAPI routes for all resources",
        files: ["app/main.py", "app/routers/*.py"],
      },
      {
        id: "tests",
        name: "Test Suite",
        description: "Comprehensive pytest tests for all endpoints",
        files: ["tests/test_*.py"],
      },
      {
        id: "validate",
        name: "Validation & Fixes",
        description: "Run tests and fix any issues",
        files: [],
        isValidation: true,
      },
      {
        id: "docker-run",
        name: "Run in Docker",
        description: "Package and run the application in Docker locally",
        files: [],
        isDeployment: true,
      },
      {
        id: "azure-deploy",
        name: "Deploy to Azure",
        description: "Generate Bicep template and deploy to Azure Container Apps",
        files: ["infra/main.bicep", "infra/main.bicepparam"],
        isAzureDeployment: true,
        optional: true,
      },
    ],
  },

  "react-fastapi": {
    name: "React + FastAPI Full-Stack",
    description: "React frontend with FastAPI backend, SQLite database, and full authentication",
    stack: ["React", "TypeScript", "Vite", "Python", "FastAPI", "SQLite"],
    phases: [
      {
        id: "backend-setup",
        name: "Backend Setup",
        description: "FastAPI project structure and dependencies",
        files: ["backend/requirements.txt", "backend/app/__init__.py"],
      },
      {
        id: "backend-database",
        name: "Backend Database",
        description: "SQLAlchemy models and database configuration",
        files: ["backend/app/database.py", "backend/app/models.py", "backend/app/schemas.py"],
      },
      {
        id: "backend-api",
        name: "Backend API",
        description: "FastAPI routes and authentication",
        files: ["backend/app/main.py", "backend/app/auth.py"],
      },
      {
        id: "backend-tests",
        name: "Backend Tests",
        description: "API tests with pytest",
        files: ["backend/tests/test_*.py"],
      },
      {
        id: "frontend-setup",
        name: "Frontend Setup",
        description: "React + Vite project with TypeScript",
        files: ["frontend/package.json", "frontend/vite.config.ts", "frontend/tsconfig.json"],
      },
      {
        id: "frontend-components",
        name: "Frontend Components",
        description: "React components and pages",
        files: ["frontend/src/App.tsx", "frontend/src/components/*.tsx", "frontend/src/pages/*.tsx"],
      },
      {
        id: "frontend-api",
        name: "Frontend API Integration",
        description: "API client and hooks for backend communication",
        files: ["frontend/src/api/*.ts", "frontend/src/hooks/*.ts"],
      },
      {
        id: "integration",
        name: "Integration & Deployment",
        description: "Docker Compose for running both services",
        files: ["docker-compose.yml", "README.md"],
      },
      {
        id: "docker-run",
        name: "Run in Docker",
        description: "Package and run the application in Docker locally",
        files: [],
        isDeployment: true,
      },
      {
        id: "azure-deploy",
        name: "Deploy to Azure",
        description: "Generate Bicep template and deploy to Azure Container Apps",
        files: ["infra/main.bicep", "infra/main.bicepparam"],
        isAzureDeployment: true,
        optional: true,
      },
    ],
  },

  "nodejs-express": {
    name: "Node.js + Express Backend",
    description: "Express.js REST API with SQLite database and JWT authentication",
    stack: ["Node.js", "Express", "SQLite", "better-sqlite3", "Jest"],
    phases: [
      {
        id: "setup",
        name: "Project Setup",
        description: "Create package.json, README.md, and project structure",
        files: ["package.json", "README.md", "src/index.js"],
      },
      {
        id: "database",
        name: "Database Layer",
        description: "SQLite setup and model definitions",
        files: ["src/db/database.js", "src/db/migrations/*.js"],
      },
      {
        id: "models",
        name: "Data Models",
        description: "Model classes with validation",
        files: ["src/models/*.js"],
      },
      {
        id: "auth",
        name: "Authentication",
        description: "JWT authentication middleware",
        files: ["src/middleware/auth.js", "src/routes/auth.js"],
      },
      {
        id: "routes",
        name: "API Routes",
        description: "Express routes for all resources",
        files: ["src/routes/*.js"],
      },
      {
        id: "tests",
        name: "Test Suite",
        description: "Jest tests for all endpoints",
        files: ["tests/*.test.js"],
      },
      {
        id: "validate",
        name: "Validation & Fixes",
        description: "Run tests and fix any issues",
        files: [],
        isValidation: true,
      },
      {
        id: "docker-run",
        name: "Run in Docker",
        description: "Package and run the application in Docker locally",
        files: [],
        isDeployment: true,
      },
      {
        id: "azure-deploy",
        name: "Deploy to Azure",
        description: "Generate Bicep template and deploy to Azure Container Apps",
        files: ["infra/main.bicep", "infra/main.bicepparam"],
        isAzureDeployment: true,
        optional: true,
      },
    ],
  },

  "custom": {
    name: "Custom Architecture",
    description: "AI will analyze your requirements and propose a custom architecture",
    stack: ["Determined by AI based on requirements"],
    phases: [], // Phases will be generated dynamically
  },
};

/**
 * Orchestrator class manages the multi-step generation process
 */
export class Orchestrator {
  constructor(workspaceDir, onEvent) {
    this.workspaceDir = workspaceDir;
    this.onEvent = onEvent; // Callback for SSE events
    this.state = {
      archetype: null,
      phases: [],
      currentPhaseIndex: -1,
      status: "initializing", // initializing, planning, awaiting_confirmation, generating, completed, error
      generatedFiles: [],
      errors: [],
    };
  }

  /**
   * Emit an event to the client
   */
  emit(type, data) {
    this.onEvent?.({ type, data });
  }

  /**
   * Get available archetypes for the user to choose from
   */
  getArchetypeOptions() {
    return Object.entries(ARCHETYPES).map(([id, arch]) => ({
      id,
      name: arch.name,
      description: arch.description,
      stack: arch.stack,
    }));
  }

  /**
   * Initialize the orchestrator with a selected archetype
   */
  async selectArchetype(archetypeId, userPrompt, attachment) {
    const archetype = ARCHETYPES[archetypeId];
    if (!archetype) {
      throw new Error(`Unknown archetype: ${archetypeId}`);
    }

    this.state.archetype = archetypeId;
    this.state.userPrompt = userPrompt;
    this.state.attachment = attachment;

    if (archetypeId === "custom") {
      // For custom, we need to generate phases based on the requirements
      this.emit("status", { message: "Analyzing requirements to propose architecture..." });
      this.state.phases = await this.generateCustomPhases(userPrompt, attachment);
    } else {
      this.state.phases = archetype.phases.map((p, index) => ({
        ...p,
        index,
        status: "pending", // pending, in_progress, completed, skipped, error
        files: [],
      }));
    }

    this.state.status = "planning";
    this.emit("plan", {
      archetype: archetype.name,
      phases: this.state.phases,
    });

    return this.state.phases;
  }

  /**
   * Generate custom phases based on requirements analysis
   */
  async generateCustomPhases(userPrompt, attachment) {
    // This would use the Copilot SDK to analyze and propose phases
    // For now, return a reasonable default based on common patterns
    const hasAuth = /auth|login|user|password|jwt|session/i.test(userPrompt + (attachment?.content || ""));
    const hasFrontend = /frontend|react|vue|angular|ui|interface|web app/i.test(userPrompt + (attachment?.content || ""));
    const hasDatabase = /database|db|sql|postgres|mysql|mongo|storage/i.test(userPrompt + (attachment?.content || ""));

    const phases = [
      { id: "setup", name: "Project Setup", description: "Dependencies and project structure" },
    ];

    if (hasDatabase) {
      phases.push({ id: "database", name: "Database Layer", description: "Database models and configuration" });
      phases.push({ id: "schemas", name: "Data Schemas", description: "Validation schemas" });
    }

    if (hasAuth) {
      phases.push({ id: "auth", name: "Authentication", description: "User authentication and authorization" });
    }

    phases.push({ id: "core", name: "Core Logic", description: "Main application logic and business rules" });
    phases.push({ id: "api", name: "API Layer", description: "API endpoints and routes" });

    if (hasFrontend) {
      phases.push({ id: "frontend", name: "Frontend", description: "User interface components" });
    }

    phases.push({ id: "tests", name: "Test Suite", description: "Automated tests" });
    phases.push({ id: "validate", name: "Validation", description: "Run tests and fix issues" });

    return phases.map((p, index) => ({
      ...p,
      index,
      status: "pending",
      files: [],
    }));
  }

  /**
   * Get the current phase
   */
  getCurrentPhase() {
    if (this.state.currentPhaseIndex < 0 || this.state.currentPhaseIndex >= this.state.phases.length) {
      return null;
    }
    return this.state.phases[this.state.currentPhaseIndex];
  }

  /**
   * Get the next pending phase
   */
  getNextPhase() {
    const nextIndex = this.state.phases.findIndex(p => p.status === "pending");
    if (nextIndex === -1) return null;
    return { phase: this.state.phases[nextIndex], index: nextIndex };
  }

  /**
   * Start or resume generation - waits for user confirmation before each phase
   */
  async proposeNextPhase() {
    const next = this.getNextPhase();
    if (!next) {
      this.state.status = "completed";
      this.emit("completed", {
        workspace: this.workspaceDir,
        files: this.state.generatedFiles,
      });
      return null;
    }

    this.state.status = "awaiting_confirmation";
    this.emit("phase_proposal", {
      phase: next.phase,
      phaseIndex: next.index,
      totalPhases: this.state.phases.length,
      message: `Ready to generate: ${next.phase.name}`,
      description: next.phase.description,
    });

    return next.phase;
  }

  /**
   * User confirms to proceed with the proposed phase
   */
  async confirmPhase(phaseIndex) {
    if (phaseIndex !== this.getNextPhase()?.index) {
      throw new Error("Phase mismatch - cannot confirm a different phase");
    }

    const phase = this.state.phases[phaseIndex];
    phase.status = "in_progress";
    this.state.currentPhaseIndex = phaseIndex;
    this.state.status = "generating";

    this.emit("phase_start", {
      phase,
      phaseIndex,
      totalPhases: this.state.phases.length,
    });

    try {
      const result = await this.executePhase(phase);
      
      phase.status = "completed";
      phase.files = result.files || [];
      phase.result = result;
      if (result.files) {
        this.state.generatedFiles.push(...result.files);
      }

      // Emit special events for deployment phases
      if (result.requiresDeployment && result.deploymentType === "docker") {
        this.emit("docker_deploy_ready", {
          phase,
          phaseIndex,
          workspaceDir: this.workspaceDir,
        });
      } else if (result.requiresDeployment && result.deploymentType === "azure") {
        this.emit("azure_deploy_ready", {
          phase,
          phaseIndex,
          workspaceDir: this.workspaceDir,
          files: result.files,
        });
      } else if (result.requiresValidation) {
        this.emit("validation_ready", {
          phase,
          phaseIndex,
          workspaceDir: this.workspaceDir,
        });
      } else {
        this.emit("phase_complete", {
          phase,
          phaseIndex,
          files: result.files,
          summary: result.summary,
        });
      }

      // Automatically propose the next phase (unless deployment is in progress)
      if (!result.requiresDeployment && !result.requiresValidation) {
        return await this.proposeNextPhase();
      }
      
      return result;

    } catch (error) {
      phase.status = "error";
      phase.error = error.message;
      this.state.errors.push({ phase: phase.id, error: error.message });

      this.emit("phase_error", {
        phase,
        phaseIndex,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Mark current deployment phase as complete and propose next
   */
  async completeDeploymentPhase(phaseIndex, deploymentResult) {
    const phase = this.state.phases[phaseIndex];
    
    this.emit("phase_complete", {
      phase,
      phaseIndex,
      files: phase.files || [],
      summary: deploymentResult.summary || "Deployment completed",
      deploymentResult,
    });
    
    return await this.proposeNextPhase();
  }

  /**
   * User skips a phase (if optional)
   */
  async skipPhase(phaseIndex) {
    const phase = this.state.phases[phaseIndex];
    if (!phase.optional) {
      throw new Error(`Phase "${phase.name}" is required and cannot be skipped`);
    }

    phase.status = "skipped";
    this.emit("phase_skipped", { phase, phaseIndex });

    return await this.proposeNextPhase();
  }

  /**
   * Execute a single phase - generates files for that phase
   */
  async executePhase(phase) {
    // Handle special deployment phases
    if (phase.isDeployment) {
      return await this.executeDockerDeployment(phase);
    }
    
    if (phase.isAzureDeployment) {
      return await this.executeAzureDeployment(phase);
    }
    
    if (phase.isValidation) {
      return await this.executeValidation(phase);
    }

    const archetype = ARCHETYPES[this.state.archetype];
    
    // Build phase-specific prompt
    const phasePrompt = this.buildPhasePrompt(phase, archetype);

    // Generate files using Copilot SDK
    const result = await generatePhaseWithCopilot({
      prompt: phasePrompt,
      workspaceDir: this.workspaceDir,
      phase: phase,
      archetype: this.state.archetype,
      previousPhases: this.state.phases.filter(p => p.status === "completed"),
      userPrompt: this.state.userPrompt,
      attachment: this.state.attachment,
      onLog: (text) => this.emit("log", { text }),
      onFileWrite: (file) => this.emit("file", file),
      onTrace: (text, level) => this.emit("console_trace", { text, level }),
    });

    // Validate the generated files
    const validation = await this.validatePhase(phase, result.files);
    if (!validation.valid) {
      result.warnings = validation.warnings;
    }

    return result;
  }

  /**
   * Execute Docker deployment phase
   */
  async executeDockerDeployment(phase) {
    this.emit("log", { text: "\n🐳 Packaging and running application in Docker...\n" });
    
    // This will be handled by the server's deployment logic
    // Return a special result that tells the server to deploy
    return {
      success: true,
      files: [],
      summary: "Docker deployment initiated",
      deploymentType: "docker",
      requiresDeployment: true,
    };
  }

  /**
   * Execute Azure deployment phase
   */
  async executeAzureDeployment(phase) {
    this.emit("log", { text: "\n☁️ Preparing Azure deployment...\n" });
    this.emit("console_trace", { text: "Starting Azure infrastructure generation", level: "info" });
    
    const archetype = ARCHETYPES[this.state.archetype];
    
    // Generate Bicep template using Copilot SDK
    const bicepPrompt = this.buildAzureBicepPrompt(archetype);
    
    const result = await generatePhaseWithCopilot({
      prompt: bicepPrompt,
      workspaceDir: this.workspaceDir,
      phase: phase,
      archetype: this.state.archetype,
      previousPhases: this.state.phases.filter(p => p.status === "completed"),
      userPrompt: this.state.userPrompt,
      attachment: this.state.attachment,
      onLog: (text) => this.emit("log", { text }),
      onFileWrite: (file) => this.emit("file", file),
      onTrace: (text, level) => this.emit("console_trace", { text, level }),
    });
    
    result.deploymentType = "azure";
    result.requiresDeployment = true;
    
    return result;
  }

  /**
   * Execute validation phase - run tests
   */
  async executeValidation(phase) {
    this.emit("log", { text: "\n🧪 Running tests to validate generated code...\n" });
    this.emit("console_trace", { text: "Initiating validation phase", level: "info" });
    
    // This will be handled by the server's test logic
    return {
      success: true,
      files: [],
      summary: "Validation initiated",
      deploymentType: "validation",
      requiresValidation: true,
    };
  }

  /**
   * Build prompt for generating Azure Bicep templates
   */
  buildAzureBicepPrompt(archetype) {
    const projectName = path.basename(this.workspaceDir).replace(/_/g, "-");
    
    return `Generate Azure Bicep infrastructure-as-code templates to deploy this ${archetype?.name || "application"} to Azure.

PROJECT: ${projectName}
WORKSPACE: ${this.workspaceDir}

USER REQUIREMENTS:
${this.state.userPrompt}

INFRASTRUCTURE REQUIREMENTS:
Create Bicep templates that deploy the application to Azure Container Apps with the following:

1. Create infra/main.bicep with:
   - Azure Container Registry (ACR) to store the Docker image
   - Azure Container App Environment
   - Azure Container App running the application
   - Azure Log Analytics Workspace for monitoring
   - Proper networking and security settings
   - Environment variables for configuration

2. Create infra/main.bicepparam with:
   - Parameter values for the deployment
   - Location set to 'eastus' by default
   - Resource naming based on project: ${projectName}

3. Create a Dockerfile in the project root (if not exists) that:
   - Uses Python 3.11 slim image
   - Installs dependencies from requirements.txt
   - Runs uvicorn on port 8000

4. Create deploy.sh (bash script) that:
   - Logs into Azure (az login)
   - Creates a resource group
   - Builds and pushes Docker image to ACR
   - Deploys using az deployment group create with Bicep

CRITICAL:
- Use write_file for each file
- Make the Bicep template production-ready
- Include proper RBAC and managed identity
- Set sensible defaults for SKUs (consumption tier for Container Apps)`;
  }

  /**
   * Build a prompt specific to the current phase
   */
  buildPhasePrompt(phase, archetype) {
    const completedPhases = this.state.phases
      .filter(p => p.status === "completed")
      .map(p => `- ${p.name}: ${p.files.join(", ")}`)
      .join("\n");

    const existingFiles = this.listExistingFiles();

    let prompt = `You are generating code for the "${phase.name}" phase of a ${archetype?.name || "custom"} project.

PROJECT CONTEXT:
${this.state.userPrompt}

${this.state.attachment ? `SPECIFICATION DOCUMENT:
${this.state.attachment.content}` : ""}

CURRENT PHASE: ${phase.name}
PHASE DESCRIPTION: ${phase.description}
EXPECTED FILES: ${phase.files?.join(", ") || "Determine based on requirements"}

${completedPhases ? `ALREADY COMPLETED PHASES:
${completedPhases}` : ""}

${existingFiles.length > 0 ? `EXISTING FILES IN PROJECT:
${existingFiles.join("\n")}` : ""}

CRITICAL INSTRUCTIONS:
1. Use write_file tool to create EACH file for this phase
2. Use Pydantic v2 syntax (use 'pattern=' not 'regex=' for string constraints)
3. Include proper imports referencing existing files
4. Maintain consistency with already generated code
5. Do NOT regenerate files from previous phases unless fixing imports

Generate all files for this phase now.`;

    return prompt;
  }

  /**
   * List existing files in the workspace
   */
  listExistingFiles() {
    const files = [];
    const walk = (dir, prefix = "") => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (["__pycache__", ".venv", "node_modules", ".git"].includes(entry.name)) continue;
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), relPath);
        } else {
          files.push(relPath);
        }
      }
    };
    walk(this.workspaceDir);
    return files;
  }

  /**
   * Validate generated files for a phase
   */
  async validatePhase(phase, files) {
    const warnings = [];
    
    // Check that expected files were created
    if (phase.files && phase.files.length > 0) {
      for (const expectedFile of phase.files) {
        // Handle glob patterns like "tests/test_*.py"
        if (expectedFile.includes("*")) continue;
        
        const fullPath = path.join(this.workspaceDir, expectedFile);
        if (!fs.existsSync(fullPath)) {
          warnings.push(`Expected file not created: ${expectedFile}`);
        }
      }
    }

    // For Python files, do a basic syntax check
    for (const file of files) {
      if (file.endsWith(".py")) {
        const content = fs.readFileSync(path.join(this.workspaceDir, file), "utf8");
        
        // Check for common issues
        if (content.includes("regex=") && content.includes("constr")) {
          warnings.push(`${file}: Uses deprecated 'regex=' (should be 'pattern=' for Pydantic v2)`);
        }
      }
    }

    return {
      valid: warnings.length === 0,
      warnings,
    };
  }

  /**
   * Get current state for client
   */
  getState() {
    return {
      ...this.state,
      archetype: ARCHETYPES[this.state.archetype],
    };
  }
}

/**
 * Create a new orchestrator instance
 */
export function createOrchestrator(workspaceDir, onEvent) {
  return new Orchestrator(workspaceDir, onEvent);
}
