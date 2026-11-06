import { z } from "zod";

export const calendarDateSchema = z.iso
  .date()
  .refine(
    (value) => !value.startsWith("0000-"),
    "Calendar dates require a year from 0001 to 9999",
  );
