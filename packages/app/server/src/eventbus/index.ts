/**
 * @fileoverview EventBus - Main entry point
 * 
 * Type-safe event bus system based on OpenCode's Bus pattern.
 * 
 * @example
 * ```typescript
 * // Define event
 * const MyEvent = BusEvent.define("my.event", z.object({ id: z.string() }));
 * 
 * // Subscribe
 * const unsubscribe = Bus.subscribe(MyEvent, (event) => {
 *   console.log(event.properties.id);
 * });
 * 
 * // Publish
 * await Bus.publish(MyEvent, { id: "123" });
 * 
 * // Unsubscribe
 * unsubscribe();
 * ```
 */

// Core exports
export * as BusEvent from "./bus-event.js";
export * from "./bus.js";
export * from "./global.js";
export * from "./types.js";

// Event exports
export * from "./events/index.js";
