// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Checkbox } from "../checkbox";
import { Switch } from "../switch";
import { Dialog, DialogContent, DialogTitle } from "../dialog";

afterEach(cleanup);

// Source/DOM contract only: the saved host browser RED remains the actual-hit
// evidence. The parent must rerun that browser probe after this fix.
it.each(["checkbox", "switch", "dialog close"])(
  "%s keeps an invisible square hit region inside its rounded 44px root",
  (control) => {
    render(control === "checkbox" ? <Checkbox aria-label="Check" /> :
      control === "switch" ? <Switch aria-label="Toggle" /> :
      <Dialog open><DialogContent aria-describedby={undefined}><DialogTitle>Test</DialogTitle></DialogContent></Dialog>);
    const root = control === "dialog close" ? screen.getByRole("button", { name: "Close" }) : screen.getByRole(control);
    const classes = root.className.split(/\s+/);
    for (const token of ["after:absolute", "after:inset-0", "after:content-['']", "after:rounded-none"]) {
      expect(classes).toContain(token);
    }
    expect(classes).not.toContain("overflow-hidden");
    expect(classes).not.toContain("after:pointer-events-none");
    expect(classes.some((token) => token.startsWith("after:bg-"))).toBe(false);
    if (control === "checkbox") {
      expect(classes).toEqual(expect.arrayContaining(["relative", "min-h-11", "min-w-11", "rounded-[8px]"]));
      expect(root.querySelector("span.size-5")).not.toBeNull();
    } else if (control === "switch") {
      expect(classes).toEqual(expect.arrayContaining(["relative", "min-h-11", "w-11", "rounded-full", "before:h-6", "before:inset-x-0", "before:rounded-full"]));
    } else {
      expect(classes).toEqual(expect.arrayContaining(["absolute", "size-11", "rounded-full", "hover:bg-paper-2"]));
    }
  },
);
