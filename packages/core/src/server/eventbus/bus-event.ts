/**
 * @fileoverview BusEvent - Type-safe event definitions using Zod
 * 
 * Based on OpenCode's BusEvent pattern.
 * All events are defined with Zod schemas for runtime validation and type safety.
 */

import { z, type ZodType } from "zod";

/**
 * Event definition with type and schema
 */
export interface EventDefinition<Type extends string = string, Properties extends ZodType = ZodType> {
  type: Type;
  properties: Properties;
}

/**
 * Payload type derived from event definition
 */
export type EventPayload<Def extends EventDefinition> = {
  type: Def["type"];
  properties: Def["properties"] extends ZodType<infer T> ? T : never;
};

/**
 * Global event registry for tracking all defined events
 */
const registry = new Map<string, EventDefinition>();

/**
 * Define a new event type with Zod schema
 * 
 * @example
 * ```typescript
 * const UserCreatedEvent = BusEvent.define(
 *   "user.created",
 *   z.object({ id: z.string(), name: z.string() })
 * );
 * ```
 */
export function define<Type extends string, Properties extends ZodType>(
  type: Type,
  properties: Properties
): EventDefinition<Type, Properties> {
  const definition: EventDefinition<Type, Properties> = {
    type,
    properties,
  };
  
  registry.set(type, definition);
  return definition;
}

/**
 * Get all registered event definitions
 */
export function getRegistry(): Map<string, EventDefinition> {
  return new Map(registry);
}

/**
 * Clear the registry (useful for testing)
 */
export function clearRegistry(): void {
  registry.clear();
}

/**
 * Validate event payload against its schema
 */
export function validate<Def extends EventDefinition>(
  definition: Def,
  payload: unknown
): EventPayload<Def> {
  const schema = z.object({
    type: z.literal(definition.type),
    properties: definition.properties,
  });
  
  return schema.parse(payload) as EventPayload<Def>;
}
