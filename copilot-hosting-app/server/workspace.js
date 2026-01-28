import fs from "node:fs";
import path from "node:path";

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function safeJoin(root, rel) {
  // Sanitize relative path to prevent directory traversal
  const clean = rel.replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const full = path.join(root, clean);
  const resolvedRoot = path.resolve(root);
  const resolvedFull = path.resolve(full);
  if (!resolvedFull.startsWith(resolvedRoot)) {
    throw new Error("Path traversal blocked");
  }
  return resolvedFull;
}

export function writeFile(root, relPath, content) {
  const full = safeJoin(root, relPath);
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, content, "utf8");
}

export function readFile(root, relPath) {
  const full = safeJoin(root, relPath);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, "utf8");
}

export function listFiles(dir, prefix = "") {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      // Skip common directories we don't want to list
      if (entry.name === ".venv" || entry.name === "__pycache__" || entry.name === ".git") {
        continue;
      }
      results.push(...listFiles(path.join(dir, entry.name), relPath));
    } else {
      results.push(relPath);
    }
  }
  return results;
}
