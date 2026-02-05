import { z } from "zod";
import { ToolInfo, ToolContext, ToolResult } from "../types";

export function define<Parameters extends z.ZodType>(
  name: string,
  init?: ToolInfo<Parameters>["init"],
): ToolInfo<Parameters>;

export function define<Parameters extends z.ZodType>(
  info: Omit<ToolInfo<Parameters>, "name"> & { name?: string },
): ToolInfo<Parameters>;

export function define<Parameters extends z.ZodType>(
  nameOrInfo: string | Omit<ToolInfo<Parameters>, "name"> & { name?: string },
  initValue?: ToolInfo<Parameters>["init"],
): ToolInfo<Parameters> {
  if (typeof nameOrInfo === "string") {
    return {
      name: nameOrInfo,
      description: "",
      parameters: z.object({}) as unknown as Parameters,
      execute: async () => ({ success: true, output: "" }),
    };
  }

  const info = nameOrInfo as Omit<ToolInfo<Parameters>, "name"> & { name?: string };
  return {
    name: info.name || "",
    description: info.description || "",
    parameters: (info.parameters || z.object({})) as unknown as Parameters,
    init: info.init,
    execute: info.execute,
    formatValidationError: info.formatValidationError,
  } as unknown as ToolInfo<Parameters>;
}

export function tool<Parameters extends z.ZodType>(
  info: Omit<ToolInfo<Parameters>, "name"> & { name?: string },
): ToolInfo<Parameters> {
  return define({
    ...info,
    name: info.name || "",
  }) as ToolInfo<Parameters>;
}
