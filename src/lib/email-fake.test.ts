import { describe, expect, it } from "vitest";
import { createFakeEmailTransport } from "@/lib/email-fake";
import { passwordResetEmail } from "@/lib/email-templates";

describe("createFakeEmailTransport", () => {
  it("captures sent messages in order and returns stable ids", async () => {
    const mail = createFakeEmailTransport();
    const r1 = await mail.send({ to: "a@x.com", subject: "one", html: "<p>1</p>" });
    const r2 = await mail.send({ to: "b@x.com", subject: "two", html: "<p>2</p>" });

    expect(r1.id).toBe("fake-1");
    expect(r2.id).toBe("fake-2");
    expect(mail.sent).toHaveLength(2);
    expect(mail.sent.map((m) => m.to)).toEqual(["a@x.com", "b@x.com"]);
    expect(mail.last()?.subject).toBe("two");
  });

  it("works as a drop-in for a template send", async () => {
    const mail = createFakeEmailTransport();
    await mail.send({ to: "u@x.com", ...passwordResetEmail({ resetUrl: "https://app/r" }) });
    expect(mail.last()?.subject).toBe("Reset your RVLT Flow password");
    expect(mail.last()?.html).toContain('href="https://app/r"');
  });

  it("clear() resets captured state", async () => {
    const mail = createFakeEmailTransport();
    await mail.send({ to: "a@x.com", subject: "x", html: "" });
    mail.clear();
    expect(mail.sent).toHaveLength(0);
    expect(mail.last()).toBeUndefined();
  });
});
