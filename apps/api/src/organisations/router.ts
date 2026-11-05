import {
  changeMemberRoleInputSchema,
  createOrganisationInputSchema,
  memberInputSchema,
  memberPageInputSchema,
  memberPageSchema,
  organisationInputSchema,
  organisationMemberSchema,
  organisationPageInputSchema,
  organisationPageSchema,
  organisationSchema,
  updateOrganisationInputSchema,
} from "@kithwork/contracts";
import { z } from "zod";
import { authenticatedProcedure, router } from "../trpc/procedures.js";
import * as service from "./service.js";

const organisationProcedure = authenticatedProcedure
  .input(z.object(organisationInputSchema.shape))
  .use(async ({ ctx, input, next }) => {
    const organisation = await service.loadOrganisationAccess(
      ctx.db,
      ctx.user.id,
      input.organisationId,
    );
    return next({
      ctx: {
        organisation,
        log: ctx.log.child({
          organisationId: organisation.id,
          actorId: ctx.user.id,
        }),
      },
    });
  });
const successSchema = z.strictObject({ success: z.literal(true) });

export const organisationsRouter = router({
  create: authenticatedProcedure
    .input(createOrganisationInputSchema)
    .output(organisationSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.consumeOrganisationCreationLimit(ctx.user.id);
      const result = await service.createOrganisation(
        ctx.db,
        ctx.user.id,
        input.name,
      );
      ctx.log.info(
        {
          organisationId: result.id,
          actorId: ctx.user.id,
          action: "organisation.created",
        },
        "Organisation access changed",
      );
      return result;
    }),
  list: authenticatedProcedure
    .input(organisationPageInputSchema)
    .output(organisationPageSchema)
    .query(({ ctx, input }) =>
      service.listOrganisations(ctx.db, ctx.user.id, input),
    ),
  get: organisationProcedure
    .input(organisationInputSchema)
    .output(organisationSchema)
    .query(({ ctx }) => ctx.organisation),
  update: organisationProcedure
    .input(updateOrganisationInputSchema)
    .output(organisationSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await service.updateOrganisation(
        ctx.db,
        ctx.user.id,
        input.organisationId,
        input.name,
      );
      ctx.log.info(
        { action: "organisation.updated" },
        "Organisation access changed",
      );
      return result;
    }),
  members: router({
    list: organisationProcedure
      .input(memberPageInputSchema)
      .output(memberPageSchema)
      .query(({ ctx, input }) =>
        service.listMembers(ctx.db, ctx.organisation.id, input),
      ),
    changeRole: organisationProcedure
      .input(changeMemberRoleInputSchema)
      .output(organisationMemberSchema)
      .mutation(async ({ ctx, input }) => {
        const result = await service.changeMemberRole(
          ctx.db,
          ctx.user.id,
          input.organisationId,
          input.userId,
          input.role,
        );
        ctx.log.info(
          {
            action: "membership.role_changed",
            targetUserId: input.userId,
            role: input.role,
          },
          "Organisation access changed",
        );
        return result;
      }),
    remove: organisationProcedure
      .input(memberInputSchema)
      .output(successSchema)
      .mutation(async ({ ctx, input }) => {
        const result = await service.removeMember(
          ctx.db,
          ctx.user.id,
          input.organisationId,
          input.userId,
        );
        ctx.log.info(
          { action: "membership.removed", targetUserId: input.userId },
          "Organisation access changed",
        );
        return result;
      }),
  }),
  leave: organisationProcedure
    .input(organisationInputSchema)
    .output(successSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await service.removeMember(
        ctx.db,
        ctx.user.id,
        input.organisationId,
        ctx.user.id,
        true,
      );
      ctx.log.info(
        { action: "membership.left" },
        "Organisation access changed",
      );
      return result;
    }),
});
