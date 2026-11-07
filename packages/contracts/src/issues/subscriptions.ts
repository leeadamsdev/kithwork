import { z } from "zod";
import { issueInputSchema } from "./inputs.js";

export const issueSubscriptionStates = ["watching", "muted"] as const;
export const setIssueFollowingInputSchema = issueInputSchema.extend({
  following: z.boolean(),
});
export type SetIssueFollowingInput = z.infer<
  typeof setIssueFollowingInputSchema
>;
export const issueFollowingSchema = issueInputSchema.extend({
  following: z.boolean(),
});
export type IssueFollowing = z.infer<typeof issueFollowingSchema>;
