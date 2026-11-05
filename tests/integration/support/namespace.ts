import { randomUUID } from "node:crypto";
export function uniqueNamespace(): string {
  return `kw_test_${randomUUID().replaceAll("-", "")}`;
}
