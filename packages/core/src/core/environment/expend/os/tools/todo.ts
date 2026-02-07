/**
 * @fileoverview Todo/Task management tools for OS Environment Agent
 * Based on opencode's task management pattern
 */

import { z } from "zod";
import type { ToolInfo } from "../../../../types/index.js";

// Simple in-memory todo storage (in production, this could use a database or file)
const todoStorage: Map<string, TodoItem[]> = new Map();

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  priority?: "low" | "medium" | "high";
  createdAt: string;
  completedAt?: string;
}

/**
 * Get todos for a session
 */
function getTodos(sessionId: string): TodoItem[] {
  return todoStorage.get(sessionId) || [];
}

/**
 * Update todos for a session
 */
function updateTodos(sessionId: string, todos: TodoItem[]): void {
  todoStorage.set(sessionId, todos);
}

/**
 * Create Todo Read Tool
 */
export function createTodoReadTool(): ToolInfo {
  return {
    name: "todo_read",
    description: "Read the current todo/task list for the session",
    parameters: z.object({}),
    execute: async (_args, context) => {
      const startTime = Date.now();
      const sessionId = context.session_id || "default";
      const todos = getTodos(sessionId);
      
      const pending = todos.filter(t => t.status !== "completed").length;
      const completed = todos.filter(t => t.status === "completed").length;
      
      return {
        success: true,
        output: JSON.stringify({
          todos,
          summary: {
            total: todos.length,
            pending,
            completed,
          }
        }, null, 2),
        metadata: {
          execution_time_ms: Date.now() - startTime,
          todos,
          pending,
          completed,
        },
      };
    },
  };
}

/**
 * Create Todo Write Tool
 */
export function createTodoWriteTool(): ToolInfo {
  return {
    name: "todo_write",
    description: `Update the todo/task list. Use this to:
- Add new tasks
- Mark tasks as complete/in_progress
- Update task content or priority
- Delete tasks
- Reorder tasks`,
    parameters: z.object({
      todos: z.array(z.object({
        id: z.string().describe("Unique task ID (use existing or generate new UUID)"),
        content: z.string().describe("Task description"),
        status: z.enum(["pending", "in_progress", "completed"]).describe("Task status"),
        priority: z.enum(["low", "medium", "high"]).optional().describe("Task priority"),
        createdAt: z.string().describe("Creation timestamp (ISO format)"),
        completedAt: z.string().optional().describe("Completion timestamp (ISO format)"),
      })).describe("The complete updated todo list"),
    }),
    execute: async (args, context) => {
      const startTime = Date.now();
      const sessionId = context.session_id || "default";
      const todos: TodoItem[] = args.todos.map((t: TodoItem) => ({
        ...t,
        completedAt: t.status === "completed" && !t.completedAt 
          ? new Date().toISOString() 
          : t.completedAt,
      }));
      
      updateTodos(sessionId, todos);
      
      const pending = todos.filter(t => t.status !== "completed").length;
      
      return {
        success: true,
        output: `Updated todo list. ${pending} tasks remaining.`,
        metadata: {
          execution_time_ms: Date.now() - startTime,
          todos,
          pending,
          completed: todos.filter(t => t.status === "completed").length,
        },
      };
    },
  };
}

/**
 * Create Todo Add Tool (convenience tool)
 */
export function createTodoAddTool(): ToolInfo {
  return {
    name: "todo_add",
    description: "Add a new task to the todo list",
    parameters: z.object({
      content: z.string().describe("Task description"),
      priority: z.enum(["low", "medium", "high"]).optional().describe("Task priority (default: medium)"),
    }),
    execute: async (args, context) => {
      const startTime = Date.now();
      const sessionId = context.session_id || "default";
      const todos = getTodos(sessionId);
      
      const newTodo: TodoItem = {
        id: crypto.randomUUID(),
        content: args.content,
        status: "pending",
        priority: args.priority || "medium",
        createdAt: new Date().toISOString(),
      };
      
      todos.push(newTodo);
      updateTodos(sessionId, todos);
      
      return {
        success: true,
        output: `Added task: ${args.content}`,
        metadata: {
          execution_time_ms: Date.now() - startTime,
          todo: newTodo,
          total: todos.length,
        },
      };
    },
  };
}

/**
 * Create all todo tools
 */
export function createTodoTools(): ToolInfo[] {
  return [
    createTodoReadTool(),
    createTodoWriteTool(),
    createTodoAddTool(),
  ];
}
