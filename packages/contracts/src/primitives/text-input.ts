import { z } from "zod";

export const textInputSchema = z
  .string()
  .refine(
    (value) => !value.includes("\u0000"),
    "Text must not contain NUL characters",
  );
