import { expect, test } from "vitest";
import { name } from "./index.js";

test("exports the package name", () => {
  expect(name).toBe("trusted-scopes");
});
