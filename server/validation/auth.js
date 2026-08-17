import { z } from "zod";

const intent = z.enum(["login", "signup"]);
const email = z.string().trim().toLowerCase().email().max(254);

export const emailAuthStartSchema = z
  .object({
    email,
    name: z.string().trim().max(100).default(""),
    intent,
  })
  .strict();

export const emailAuthVerifySchema = z
  .object({
    challengeId: z.string().trim().min(32).max(200),
    code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit verification code from your email"),
  })
  .strict();
