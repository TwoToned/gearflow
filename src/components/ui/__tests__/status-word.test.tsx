// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { StatusWord, gearStageValue } from "@/components/ui/status-word";
import { intentStyles } from "@/lib/status-colors";
import { GEAR_STAGE_LABELS, type GearStageKey } from "@/lib/vocabulary";

const stages = Object.keys(GEAR_STAGE_LABELS) as GearStageKey[];

describe("StatusWord (D2, D91)", () => {
  it("maps each stage to its intent: Out red, Returned amber, De-prepped green", () => {
    expect(gearStageValue("deployed").intent).toBe("primary");
    expect(gearStageValue("returned").intent).toBe("warning");
    expect(gearStageValue("deprepped").intent).toBe("success");
    expect(gearStageValue("prepped").intent).toBe("info");
    expect(gearStageValue("to_prep").intent).toBe("neutral");
  });

  it("only Closed is an outline dot", () => {
    for (const s of stages) expect(!!gearStageValue(s).outline).toBe(s === "closed");
  });

  it.each(stages)("renders %s as a dot and its word, classes from intentStyles", (stage) => {
    const v = gearStageValue(stage);
    const { container, getByText } = render(<StatusWord status={v} />);
    expect(getByText(GEAR_STAGE_LABELS[stage])).toBeTruthy();
    const dot = container.querySelector("[aria-hidden='true']")!;
    if (v.outline) {
      expect(dot.className).toContain("border");
      expect(dot.className).not.toContain(intentStyles[v.intent].dot);
    } else {
      expect(dot.className).toContain(intentStyles[v.intent].dot);
    }
    // never a filled pill
    expect(container.innerHTML).not.toContain(intentStyles[v.intent].pill);
  });
});
