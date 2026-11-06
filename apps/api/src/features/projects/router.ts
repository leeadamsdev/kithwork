import {
  createProjectInputSchema,
  projectDetailSchema,
  projectInputSchema,
  projectPageInputSchema,
  projectPageSchema,
  setProjectTeamsInputSchema,
  updateProjectInputSchema,
  versionedProjectInputSchema,
} from "@kithwork/contracts";
import { router } from "../../platform/trpc/procedures.js";
import { organisationProcedure } from "../organisations/procedure.js";
import { createProject, updateProject } from "./commands.js";
import { getProject, listProjects } from "./queries.js";
import { setProjectTeams } from "./teams.js";
import { setProjectArchived } from "./lifecycle.js";
import { requireProjectCreator } from "./team-access.js";

export const projectsRouter = router({
  create: organisationProcedure
    .input(createProjectInputSchema)
    .output(projectDetailSchema)
    .mutation(async ({ ctx, input }) => {
      await requireProjectCreator(
        ctx.db,
        ctx.user.id,
        input.organisationId,
        ctx.organisation.role,
      );
      await ctx.consumeProjectCreationLimit(ctx.user.id, input.organisationId);
      const result = await createProject(ctx.db, ctx.user.id, input);
      ctx.log.info(
        { action: "project.created", projectId: result.id },
        "Project changed",
      );
      return result;
    }),
  list: organisationProcedure
    .input(projectPageInputSchema)
    .output(projectPageSchema)
    .query(({ ctx, input }) => listProjects(ctx.db, ctx.user.id, input)),
  get: organisationProcedure
    .input(projectInputSchema)
    .output(projectDetailSchema)
    .query(({ ctx, input }) => getProject(ctx.db, ctx.user.id, input)),
  update: organisationProcedure
    .input(updateProjectInputSchema)
    .output(projectDetailSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await updateProject(ctx.db, ctx.user.id, input);
      ctx.log.info(
        { action: "project.updated", projectId: result.id },
        "Project changed",
      );
      return result;
    }),
  setTeams: organisationProcedure
    .input(setProjectTeamsInputSchema)
    .output(projectDetailSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await setProjectTeams(ctx.db, ctx.user.id, input);
      ctx.log.info(
        { action: "project.teams_changed", projectId: result.id },
        "Project changed",
      );
      return result;
    }),
  archive: organisationProcedure
    .input(versionedProjectInputSchema)
    .output(projectDetailSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await setProjectArchived(ctx.db, ctx.user.id, input, true);
      ctx.log.info(
        { action: "project.archived", projectId: result.id },
        "Project changed",
      );
      return result;
    }),
  restore: organisationProcedure
    .input(versionedProjectInputSchema)
    .output(projectDetailSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await setProjectArchived(
        ctx.db,
        ctx.user.id,
        input,
        false,
      );
      ctx.log.info(
        { action: "project.restored", projectId: result.id },
        "Project changed",
      );
      return result;
    }),
});
