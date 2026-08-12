import { z } from "zod";

const credential = z.string().trim().min(20).max(10_000);
const email = z.string().trim().toLowerCase().email().max(254);
const phone = z
  .string()
  .trim()
  .regex(/^(?:\+?91[ -]?)?[6-9][0-9 -]{9,13}$/, "Enter a valid Indian mobile number")
  .transform((value) => {
    const digits = value.replace(/\D/g, "");
    const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
    return `+91${local}`;
  })
  .refine((value) => /^\+91[6-9]\d{9}$/.test(value), "Enter a valid Indian mobile number");

export const startPhoneAuthSchema = z
  .object({
    credential,
    email,
    phone,
    intent: z.enum(["login", "signup"]),
  })
  .strict();

export const verifyPhoneAuthSchema = z
  .object({
    challengeId: z.string().trim().min(32).max(200),
    code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit verification code from your SMS"),
  })
  .strict();
