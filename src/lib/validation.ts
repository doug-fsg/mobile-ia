import { z } from "zod";

export const SESSION_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

const sessionId = z.string().regex(SESSION_ID_RE, "invalid sessionId");

export const chatRequestSchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
  sessionId: sessionId.optional(),
  model: z
    .string()
    .max(128)
    .regex(/^[a-zA-Z0-9._/-]+$/, "invalid model")
    .optional(),
  mode: z.enum(["agent", "ask", "plan"]).optional(),
  workspace: z.string().max(512).optional(),
  worktree: z.boolean().optional(),
  /** Skill names to expand server-side into the agent prompt (not shown in chat UI). */
  skills: z
    .array(z.string().min(1).max(120).regex(/^[a-zA-Z0-9._/-]+$/, "invalid skill name"))
    .max(10)
    .optional(),
});

export const deleteSessionSchema = z.object({
  sessionId,
});

export const sessionIdParam = sessionId;

export function parseBody<T>(schema: z.ZodType<T>, data: unknown): { data: T } | { error: string } {
  const result = schema.safeParse(data);
  if (result.success) return { data: result.data };
  const first = result.error.issues[0];
  return { error: first?.message ?? "Validation failed" };
}
