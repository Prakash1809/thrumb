import { z } from "zod";

import { MIN_PASSWORD_LENGTH, validatePasswordStrength } from "@/lib/password";

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  // Sign-in does not apply the strength policy: accounts created before a
  // policy change must still be able to authenticate.
  password: z.string().min(1).max(200),
});

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(200)
    .superRefine((value, ctx) => {
      const problem = validatePasswordStrength(value);
      if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
    }),
});

/** Slack-ish channel names: lowercase, no spaces. */
export const channelNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Channel name is required")
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "Use lowercase letters, numbers, hyphens and underscores");

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Workspace name is required").max(80),
});

export const createChannelSchema = z.object({
  name: channelNameSchema,
  topic: z.string().trim().max(250).optional().or(z.literal("")),
  isPrivate: z.boolean().optional().default(false),
});

/**
 * Attachment keys are minted server-side by lib/uploads.ts as
 * `<workspaceId>/<yyyy>/<mm>/<uuid><ext>`. Pinning the shape here means a
 * client cannot smuggle a traversal sequence or another workspace's path into
 * an Attachment row, even though readUpload would also refuse to serve it.
 */
export const ATTACHMENT_KEY_PATTERN =
  /^[A-Za-z0-9]{1,40}\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[A-Za-z0-9]{1,11})?$/;

export const attachmentInputSchema = z.object({
  key: z.string().max(300).regex(ATTACHMENT_KEY_PATTERN, "Invalid attachment reference"),
  name: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(127),
  size: z.number().int().nonnegative().max(100 * 1024 * 1024),
  width: z.number().int().positive().max(100_000).nullable().optional(),
  height: z.number().int().positive().max(100_000).nullable().optional(),
});

export const sendMessageSchema = z
  .object({
    body: z.string().max(8000).default(""),
    parentId: z.string().min(1).max(64).optional().nullable(),
    attachments: z.array(attachmentInputSchema).max(10).optional().default([]),
    // Echoed back on the broadcast so the sender can reconcile its optimistic
    // row instead of rendering the message twice.
    clientId: z.string().min(1).max(64).optional(),
  })
  .refine((v) => v.body.trim().length > 0 || v.attachments.length > 0, {
    message: "Message cannot be empty",
    path: ["body"],
  });

export const editMessageSchema = z.object({
  body: z.string().trim().min(1, "Message cannot be empty").max(8000),
});

/**
 * A reaction is an emoji, not a label. Rejecting ASCII letters and digits stops
 * the field being used as a second, unmoderated message body hanging off every
 * message, and keeps the grouping key short.
 */
export const reactionSchema = z.object({
  emoji: z
    .string()
    .trim()
    .min(1)
    .max(24)
    .refine((v) => !/[A-Za-z0-9]/.test(v) || /^[a-z0-9_+-]{1,24}$/.test(v), {
      message: "Reactions must be an emoji or a shortcode",
    })
    .refine((v) => !/\s/.test(v), { message: "Reactions cannot contain spaces" }),
});

export const openDmSchema = z.object({
  userIds: z.array(z.string().min(1).max(64)).min(1).max(8),
});

export const searchSchema = z.object({
  q: z.string().trim().min(2, "Search for at least 2 characters").max(200),
  channelId: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(25),
});

export const createInviteSchema = z.object({
  /** 0 means unlimited. */
  maxUses: z.number().int().min(0).max(1000).optional().default(0),
  expiresInHours: z.number().int().min(1).max(24 * 90).optional().default(24 * 7),
  role: z.enum(["MEMBER", "ADMIN"]).optional().default("MEMBER"),
});
