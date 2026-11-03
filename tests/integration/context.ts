import { inject } from "vitest";

export interface IntegrationServices {
  postgresUrl: string;
  redisUrl: string;
}

declare module "vitest" {
  interface ProvidedContext {
    services: IntegrationServices;
  }
}

export function integrationServices(): IntegrationServices {
  return inject("services");
}
