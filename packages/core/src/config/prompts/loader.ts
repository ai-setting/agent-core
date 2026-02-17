import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { ConfigPaths } from "../paths.js";
import type { LoadedPrompt } from "./types.js";
import { PromptMetadataSchema } from "./types.js";

const PROMPT_FILE_EXTENSION = ".prompt";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BUILTIN_PROMPTS_DIR = path.join(__dirname, "..", "..", "environments");

function getBuiltinPromptsDir(envName: string): string {
  return path.join(BUILTIN_PROMPTS_DIR, envName, "prompts");
}

interface FrontmatterResult {
  data: Record<string, unknown>;
  content: string;
}

function parseFrontmatter(content: string): FrontmatterResult {
  const lines = content.split("\n");
  
  if (lines[0]?.trim() !== "---") {
    return { data: {}, content: content };
  }
  
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      endIndex = i;
      break;
    }
  }
  
  if (endIndex === -1) {
    return { data: {}, content: content };
  }
  
  const frontmatterLines = lines.slice(1, endIndex);
  const bodyLines = lines.slice(endIndex + 1);
  
  const data: Record<string, unknown> = {};
  
  for (const line of frontmatterLines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    
    const key = line.slice(0, colonIndex).trim();
    let value: unknown = line.slice(colonIndex + 1).trim();
    
    if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    
    data[key] = value;
  }
  
  return {
    data,
    content: bodyLines.join("\n").trim(),
  };
}

export async function loadPromptsFromEnvironment(
  envName: string,
  basePath?: string
): Promise<LoadedPrompt[]> {
  const environmentsDir = basePath || ConfigPaths.environments;
  const promptsDir = path.join(environmentsDir, envName, "prompts");
  
  const prompts: LoadedPrompt[] = [];
  
  try {
    const files = await fs.readdir(promptsDir);
    
    for (const file of files) {
      if (!file.endsWith(PROMPT_FILE_EXTENSION)) continue;
      
      const filePath = path.join(promptsDir, file);
      const content = await fs.readFile(filePath, "utf-8");
      const { data, content: promptContent } = parseFrontmatter(content);
      
      const id = path.basename(file, PROMPT_FILE_EXTENSION);
      
      const metadata = PromptMetadataSchema.parse({
        id,
        ...data,
      });
      
      prompts.push({
        id,
        content: promptContent,
        metadata,
      });
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code: string }).code === "ENOENT") {
      // User prompts directory not found, try to load from built-in prompts
      return loadBuiltinPrompts(envName);
    }
    throw error;
  }
  
  return prompts;
}

async function loadBuiltinPrompts(envName: string): Promise<LoadedPrompt[]> {
  const builtinDir = getBuiltinPromptsDir(envName);
  const prompts: LoadedPrompt[] = [];
  
  try {
    const files = await fs.readdir(builtinDir);
    
    for (const file of files) {
      if (!file.endsWith(PROMPT_FILE_EXTENSION)) continue;
      
      const filePath = path.join(builtinDir, file);
      const content = await fs.readFile(filePath, "utf-8");
      const { data, content: promptContent } = parseFrontmatter(content);
      
      const id = path.basename(file, PROMPT_FILE_EXTENSION);
      
      const metadata = PromptMetadataSchema.parse({
        id,
        ...data,
      });
      
      prompts.push({
        id,
        content: promptContent,
        metadata,
      });
    }
  } catch {
    // Built-in prompts directory not found, return empty
    return [];
  }
  
  return prompts;
}

export async function loadPromptFromEnvironment(
  envName: string,
  promptId: string,
  basePath?: string
): Promise<LoadedPrompt | null> {
  const environmentsDir = basePath || ConfigPaths.environments;
  const promptPath = path.join(environmentsDir, envName, "prompts", `${promptId}${PROMPT_FILE_EXTENSION}`);
  
  try {
    const content = await fs.readFile(promptPath, "utf-8");
    const { data, content: promptContent } = parseFrontmatter(content);
    
    const metadata = PromptMetadataSchema.parse({
      id: promptId,
      ...data,
    });
    
    return {
      id: promptId,
      content: promptContent,
      metadata,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code: string }).code === "ENOENT") {
      // Try to load from built-in prompts
      return loadBuiltinPrompt(envName, promptId);
    }
    throw error;
  }
}

async function loadBuiltinPrompt(envName: string, promptId: string): Promise<LoadedPrompt | null> {
  const builtinPath = path.join(getBuiltinPromptsDir(envName), `${promptId}${PROMPT_FILE_EXTENSION}`);
  
  try {
    const content = await fs.readFile(builtinPath, "utf-8");
    const { data, content: promptContent } = parseFrontmatter(content);
    
    const metadata = PromptMetadataSchema.parse({
      id: promptId,
      ...data,
    });
    
    return {
      id: promptId,
      content: promptContent,
      metadata,
    };
  } catch {
    return null;
  }
}
