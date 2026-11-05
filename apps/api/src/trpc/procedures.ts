import { initTRPC, TRPCError } from "@trpc/server";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { ApiContext } from "./context.js";

const t = initTRPC.context<ApiContext>().create({
  errorFormatter({ shape, ctx }) {
    return {
      ...shape,
      message:
        shape.data.httpStatus >= 500 ? "Internal Server Error" : shape.message,
      data: {
        code: shape.data.code,
        httpStatus: shape.data.httpStatus,
        path: shape.data.path,
        requestId: ctx?.requestId,
      },
    };
  },
});
export const router = t.router;
export const publicProcedure = t.procedure.use(
  async ({ path, type, ctx, next }) => {
    return trace.getTracer("kithwork-api").startActiveSpan(
      `trpc ${path}`,
      {
        attributes: {
          "rpc.system": "trpc",
          "rpc.method": path,
          "rpc.type": type,
        },
      },
      async (span) => {
        try {
          const result = await next();
          if (!result.ok) span.setStatus({ code: SpanStatusCode.ERROR });
          ctx.log.debug(
            { procedure: path, type, ok: result.ok },
            "RPC completed",
          );
          return result;
        } finally {
          span.end();
        }
      },
    );
  },
);
export const authenticatedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { user: ctx.user } });
});
