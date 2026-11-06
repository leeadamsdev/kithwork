import {
  createIssueInputSchema,
  updateIssueInputSchema,
  issueInputSchema,
  issueIdentifierInputSchema,
  versionedIssueInputSchema,
  restoreIssueInputSchema,
  issueListInputSchema,
  issueActivityPageInputSchema,
  issueDetailSchema,
  issuePageSchema,
  issueActivityPageSchema,
  issueAssigneePageSchema,
  issueAssigneePageInputSchema,
} from "@kithwork/contracts";
import { router } from "../../platform/trpc/procedures.js";
import { organisationProcedure } from "../organisations/procedure.js";
import { readTeamAccess } from "../teams/access.js";
import { requireActiveTeam } from "../teams/transaction.js";
import { createIssue, updateIssue } from "./commands.js";
import { getIssue, getIssueByIdentifier, listIssues } from "./queries.js";
import { listIssueActivity } from "./activity-queries.js";
import { setIssueArchived } from "./lifecycle.js";
import { listIssueAssignees } from "./assignees.js";
import { commentsRouter } from "./comments/router.js";

export const issuesRouter = router({
  comments: commentsRouter,
  assignees: router({
    list: organisationProcedure
      .input(issueAssigneePageInputSchema)
      .output(issueAssigneePageSchema)
      .query(({ ctx, input }) =>
        listIssueAssignees(ctx.db, ctx.user.id, input),
      ),
  }),
  create: organisationProcedure
    .input(createIssueInputSchema)
    .output(issueDetailSchema)
    .mutation(async ({ ctx, input }) => {
      const access = await readTeamAccess(
        ctx.db,
        ctx.user.id,
        input.organisationId,
        input.teamId,
      );
      requireActiveTeam(access.team);
      await ctx.consumeIssueCreationLimit(ctx.user.id, input.organisationId);
      const result = await createIssue(ctx.db, ctx.user, input);
      ctx.log.info(
        {
          action: "issue.created",
          issueId: result.id,
          teamId: result.teamId,
          issueVersion: result.version,
        },
        "Issue changed",
      );
      return result;
    }),
  get: organisationProcedure
    .input(issueInputSchema)
    .output(issueDetailSchema)
    .query(({ ctx, input }) => getIssue(ctx.db, ctx.user.id, input)),
  getByIdentifier: organisationProcedure
    .input(issueIdentifierInputSchema)
    .output(issueDetailSchema)
    .query(({ ctx, input }) =>
      getIssueByIdentifier(ctx.db, ctx.user.id, input),
    ),
  list: organisationProcedure
    .input(issueListInputSchema)
    .output(issuePageSchema)
    .query(({ ctx, input }) => listIssues(ctx.db, ctx.user.id, input)),
  update: organisationProcedure
    .input(updateIssueInputSchema)
    .output(issueDetailSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await updateIssue(ctx.db, ctx.user, input);
      ctx.log.info(
        {
          action: "issue.updated",
          issueId: result.id,
          issueVersion: result.version,
        },
        "Issue changed",
      );
      return result;
    }),
  archive: organisationProcedure
    .input(versionedIssueInputSchema)
    .output(issueDetailSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await setIssueArchived(ctx.db, ctx.user, input, true);
      ctx.log.info(
        {
          action: "issue.archived",
          issueId: result.id,
          issueVersion: result.version,
        },
        "Issue changed",
      );
      return result;
    }),
  restore: organisationProcedure
    .input(restoreIssueInputSchema)
    .output(issueDetailSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await setIssueArchived(ctx.db, ctx.user, input, false);
      ctx.log.info(
        {
          action: "issue.restored",
          issueId: result.id,
          issueVersion: result.version,
        },
        "Issue changed",
      );
      return result;
    }),
  activity: router({
    list: organisationProcedure
      .input(issueActivityPageInputSchema)
      .output(issueActivityPageSchema)
      .query(({ ctx, input }) => listIssueActivity(ctx.db, ctx.user.id, input)),
  }),
});
