import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { useAuthFixture } from "./fixtures.js";

const f = useAuthFixture();

it("rejects NUL-containing profile text on registration and updates without persisting it", async () => {
  for (const field of ["name", "image"]) {
    const email = `${randomUUID()}@example.test`;
    const signup = await f.post("sign-up/email", {
      name: "Valid name",
      email,
      password: "valid-password-for-profile-12345",
      [field]: "example\u0000text",
    });
    expect(signup.statusCode, signup.body).toBe(400);
    expect(
      (
        await f.database.pool.query("SELECT id FROM auth_user WHERE email=$1", [
          email,
        ])
      ).rows,
    ).toEqual([]);
  }
  const user = await f.verifiedUser();
  const login = await f.post("sign-in/email", user);
  expect(login.statusCode, login.body).toBe(200);
  const cookie = f.cookieFrom(login);
  const snapshot = () =>
    f.database.pool.query("SELECT name,image FROM auth_user WHERE email=$1", [
      user.email,
    ]);
  const before = (await snapshot()).rows;
  for (const field of ["name", "image"]) {
    const update = await f.post(
      "update-user",
      { [field]: "example\u0000text" },
      cookie,
    );
    expect(update.statusCode, update.body).toBe(400);
  }
  expect((await snapshot()).rows).toEqual(before);
});
