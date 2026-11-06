import {
  createWorkflowStatusInputSchema,
  reorderWorkflowStatusesInputSchema,
  updateWorkflowStatusInputSchema,
  workflowInputSchema,
  workflowSchema,
  workflowStatusInputSchema,
  workflowStatusPageInputSchema,
  workflowStatusPageSchema,
} from "@kithwork/contracts";
import { router } from "../../platform/trpc/procedures.js";
import { organisationProcedure } from "../organisations/procedure.js";
import {
  createWorkflowStatus,
  setDefaultWorkflowStatus,
  updateWorkflowStatus,
} from "./commands.js";
import { reorderWorkflowStatuses } from "./ordering.js";
import { setWorkflowStatusRetired } from "./lifecycle.js";
import { getWorkflow, listWorkflowStatuses } from "./queries.js";

const workflowStatusesRouter = router({
  list: organisationProcedure
    .input(workflowStatusPageInputSchema)
    .output(workflowStatusPageSchema)
    .query(({ ctx, input }) =>
      listWorkflowStatuses(ctx.db, ctx.user.id, input),
    ),
  create: organisationProcedure
    .input(createWorkflowStatusInputSchema)
    .output(workflowSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await createWorkflowStatus(ctx.db, ctx.user.id, input);
      ctx.log.info(
        {
          action: "workflow.status_created",
          teamId: input.teamId,
          workflowVersion: result.version,
        },
        "Workflow changed",
      );
      return result;
    }),
  update: organisationProcedure
    .input(updateWorkflowStatusInputSchema)
    .output(workflowSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await updateWorkflowStatus(ctx.db, ctx.user.id, input);
      ctx.log.info(
        {
          action: "workflow.status_updated",
          teamId: input.teamId,
          statusId: input.statusId,
          workflowVersion: result.version,
        },
        "Workflow changed",
      );
      return result;
    }),
  reorder: organisationProcedure
    .input(reorderWorkflowStatusesInputSchema)
    .output(workflowSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await reorderWorkflowStatuses(ctx.db, ctx.user.id, input);
      ctx.log.info(
        {
          action: "workflow.statuses_reordered",
          teamId: input.teamId,
          workflowVersion: result.version,
        },
        "Workflow changed",
      );
      return result;
    }),
  setDefault: organisationProcedure
    .input(workflowStatusInputSchema)
    .output(workflowSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await setDefaultWorkflowStatus(ctx.db, ctx.user.id, input);
      ctx.log.info(
        {
          action: "workflow.default_changed",
          teamId: input.teamId,
          statusId: input.statusId,
          workflowVersion: result.version,
        },
        "Workflow changed",
      );
      return result;
    }),
  retire: organisationProcedure
    .input(workflowStatusInputSchema)
    .output(workflowSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await setWorkflowStatusRetired(
        ctx.db,
        ctx.user.id,
        input,
        true,
      );
      ctx.log.info(
        {
          action: "workflow.status_retired",
          teamId: input.teamId,
          statusId: input.statusId,
          workflowVersion: result.version,
        },
        "Workflow changed",
      );
      return result;
    }),
  restore: organisationProcedure
    .input(workflowStatusInputSchema)
    .output(workflowSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await setWorkflowStatusRetired(
        ctx.db,
        ctx.user.id,
        input,
        false,
      );
      ctx.log.info(
        {
          action: "workflow.status_restored",
          teamId: input.teamId,
          statusId: input.statusId,
          workflowVersion: result.version,
        },
        "Workflow changed",
      );
      return result;
    }),
});
export const workflowRouter = router({
  get: organisationProcedure
    .input(workflowInputSchema)
    .output(workflowSchema)
    .query(({ ctx, input }) => getWorkflow(ctx.db, ctx.user.id, input)),
  statuses: workflowStatusesRouter,
});
