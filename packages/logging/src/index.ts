import { pino, type DestinationStream } from "pino";
export function createLogger(level: string, destination?: DestinationStream) {
  return pino(
    {
      level,
      redact: {
        paths: [
          "password",
          "token",
          "secret",
          "databaseUrl",
          "redisUrl",
          "*.password",
          "*.token",
          "*.secret",
          "req.headers",
          "req.body",
          "res.headers",
          "err.command.args",
          "err.cause.command.args",
          "err.aggregateErrors[*].command.args",
        ],
        censor: "[Redacted]",
      },
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          path: req.url.split("?", 1)[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    },
    destination,
  );
}
