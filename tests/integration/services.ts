import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";

const serviceImagesSchema = z.object({
  services: z.object({
    postgres: z.object({ image: z.string().min(1) }),
    redis: z.object({ image: z.string().min(1) }),
    mailpit: z.object({ image: z.string().min(1) }),
  }),
});

export function parseServiceImages(value: unknown) {
  const { services } = serviceImagesSchema.parse(value);
  return {
    postgres: services.postgres.image,
    redis: services.redis.image,
    mailpit: services.mailpit.image,
  };
}

export async function readServiceImages() {
  const contents = await readFile(
    new URL("../../compose.yaml", import.meta.url),
    "utf8",
  );
  const configuration: unknown = parse(contents);
  return parseServiceImages(configuration);
}
