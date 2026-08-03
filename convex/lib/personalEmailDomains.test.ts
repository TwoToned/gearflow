import { describe, it, expect } from "vitest";
import { isPersonalEmailDomain, emailDomain } from "./personalEmailDomains";

describe("emailDomain", () => {
  it("extracts the domain, lowercased", () => {
    expect(emailDomain("Sam@Northlight.COM.AU")).toBe("northlight.com.au");
  });

  it("returns undefined for malformed input", () => {
    expect(emailDomain("not-an-email")).toBeUndefined();
    expect(emailDomain("@no-local-part.com")).toBeUndefined();
    expect(emailDomain("no-domain@")).toBeUndefined();
    expect(emailDomain("")).toBeUndefined();
  });
});

describe("isPersonalEmailDomain", () => {
  it("flags common free-mail domains", () => {
    expect(isPersonalEmailDomain("gmail.com")).toBe(true);
    expect(isPersonalEmailDomain("Gmail.com")).toBe(true);
    expect(isPersonalEmailDomain("outlook.com")).toBe(true);
    expect(isPersonalEmailDomain("icloud.com")).toBe(true);
  });

  it("does not flag a company domain", () => {
    expect(isPersonalEmailDomain("northlight.com.au")).toBe(false);
    expect(isPersonalEmailDomain("rvlt.app")).toBe(false);
  });
});
