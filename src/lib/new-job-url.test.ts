import { describe, expect, it } from "vitest";
import { newJobForClientHref } from "./new-job-url";

describe("newJobForClientHref", () => {
  it("presets the wizard's client", () => expect(newJobForClientHref("k1")).toBe("/projects/new?clientId=k1"));
  it("encodes an id so it cannot add a param", () => expect(newJobForClientHref("a&b=c")).toBe("/projects/new?clientId=a%26b%3Dc"));
});
