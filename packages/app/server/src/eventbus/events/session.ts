/**
 * @fileoverview Session events
 */

import { z } from "zod";
import { define } from "../bus-event.js";

/**
 * Session created event
 */
export const SessionCreatedEvent = define(
  "session.created",
  z.object({
    sessionId: z.string(),
    title: z.string(),
    directory: z.string().optional(),
  })
);

/**
 * Session updated event
 */
export const SessionUpdatedEvent = define(
  "session.updated",
  z.object({
    sessionId: z.string(),
    updates: z.record(z.unknown()),
  })
);

/**
 * Session deleted event
 */
export const SessionDeletedEvent = define(
  "session.deleted",
  z.object({
    sessionId: z.string(),
  })
);
