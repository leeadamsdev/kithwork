import { inject } from "vitest";

export interface IntegrationServices {
  postgresUrl: string;
  redisUrl: string;
  mailpitUrl: string;
  smtpHost: string;
  smtpPort: number;
}

declare module "vitest" {
  interface ProvidedContext {
    services: IntegrationServices;
  }
}

export function integrationServices(): IntegrationServices {
  return inject("services");
}
