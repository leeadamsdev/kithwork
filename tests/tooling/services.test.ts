import { describe, expect, it } from "vitest";
import {
  parseServiceImages,
  readServiceImages,
} from "../integration/services.js";

describe("integration service configuration", () => {
  it("reads the image references from the development Compose file", async () => {
    const images = await readServiceImages();
    expect(images.postgres).toMatch(/^postgres:.+@sha256:[a-f0-9]{64}$/);
    expect(images.redis).toMatch(/^redis:.+@sha256:[a-f0-9]{64}$/);
  });

  it("accepts unrelated Compose settings while extracting only service images", () => {
    expect(
      parseServiceImages({
        services: {
          postgres: { image: "postgres:18", ports: ["5432:5432"] },
          redis: { image: "redis:8" },
        },
        volumes: { data: {} },
      }),
    ).toEqual({ postgres: "postgres:18", redis: "redis:8" });
  });

  it.each([
    null,
    {},
    { services: { postgres: { image: 123 }, redis: { image: "" } } },
  ])("rejects missing or invalid service images: %j", (value) => {
    expect(() => parseServiceImages(value)).toThrow();
  });
});
