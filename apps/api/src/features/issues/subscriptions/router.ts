import {
  issueInputSchema,
  issueFollowingSchema,
  setIssueFollowingInputSchema,
} from "@kithwork/contracts";
import { router } from "../../../platform/trpc/procedures.js";
import { organisationProcedure } from "../../organisations/procedure.js";
import { setIssueFollowing } from "./commands.js";
import { getIssueFollowing } from "./queries.js";

export const subscriptionsRouter = router({
  getMine: organisationProcedure
    .input(issueInputSchema)
    .output(issueFollowingSchema)
    .query(({ ctx, input }) => getIssueFollowing(ctx.db, ctx.user.id, input)),
  setMine: organisationProcedure
    .input(setIssueFollowingInputSchema)
    .output(issueFollowingSchema)
    .mutation(({ ctx, input }) =>
      setIssueFollowing(ctx.db, ctx.user.id, input),
    ),
});
