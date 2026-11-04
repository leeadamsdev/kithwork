export const apiTestEnvironment = {
  NODE_ENV: "test",
  AUTH_SECRET:
    "f1e896ad5be04dc9a306c7f2918a5dbce904b13c6e82a70d3f65b948acf207de",
  MAIL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};
