import { z } from "zod";
import { STATUSES } from "./workflow";

const statusEnum = z.enum(STATUSES);

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const priorityEnum = z.enum(PRIORITIES);

export const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(256),
});

// Registration deliberately does NOT accept a role: Prisma's @default(USER)
// is the only way a global role is ever assigned from this code path.
export const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(255),
  password: z.string().min(12, "Use at least 12 characters.").max(256),
});

export const createWorkItemSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200),
  description: z.string().max(5000).default(""),
  assigneeId: z.string().min(1).max(64).nullish(),
  teamId: z.string().min(1).max(64).nullish(),
  priority: priorityEnum.default("MEDIUM"),
});

export const updateWorkItemSchema = z.object({
  // Expected version for optimistic concurrency. Required: stale writes must fail loudly.
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  assigneeId: z.string().min(1).max(64).nullable().optional(),
  teamId: z.string().min(1).max(64).nullable().optional(),
  priority: priorityEnum.optional(),
});

export const transitionSchema = z.object({
  version: z.number().int().positive(),
  to: statusEnum,
  // Optional: allow "assign + start" atomically (IN_PROGRESS requires an assignee).
  assigneeId: z.string().min(1).max(64).nullable().optional(),
});

export const listQuerySchema = z.object({
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  q: z.string().trim().max(200).optional(),
  assigneeId: z.string().min(1).max(64).optional(),
  creatorId: z.string().min(1).max(64).optional(),
  teamId: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(2000).optional(),
});

// Idempotency-Key: opaque client token, 1..64 chars. Validated, never trusted blindly.
export const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Use letters, digits, '-' or '_'.");
