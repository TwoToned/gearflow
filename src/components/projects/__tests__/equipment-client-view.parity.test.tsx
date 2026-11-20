// @vitest-environment jsdom
/**
 * UX unification §13 gate, view half: the Client view renders EXACTLY the
 * quote's table-model rows (section, rollup, name, qty, unit, discount, total,
 * disclosed members), in order. The PDF half — the quote prints the same
 * rows — is `equipment-client-view.parity-pdf.test.tsx`, on the same fixture
 * (`client-view-parity.fixture.ts`).
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { EquipmentClientViewBody } from "../equipment-client-view";
import { clientViewOf, modelTuples, NEVER_PRINTED, quoteLineItems, type Tuple } from "./client-view-parity.fixture";

/** Read the tuple back off the rendered view. */
function domTuples(container: HTMLElement): Tuple[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-client-section]")).flatMap((sec) => {
    const title = sec.querySelector("h3")?.textContent ?? "";
    const rollup = sec.querySelector("h3 + span .font-mono")?.textContent ?? "";
    return Array.from(sec.querySelectorAll<HTMLElement>("[data-client-row]")).map((row): Tuple => {
      const [name, meta] = Array.from(row.querySelectorAll(":scope > div:first-child > div > span")).map((n) => n.textContent ?? "");
      const total = row.querySelector(":scope > div:first-child > span.font-mono")?.textContent ?? "";
      const members = Array.from(row.querySelectorAll(":scope > ul > [data-client-child]"))
        .map((c) => Array.from(c.querySelector("div")?.children ?? []).map((n) => n.textContent).join(""))
        .join(",");
      return [title, rollup, name, ...splitMeta(meta), total, members] as Tuple;
    });
  });
}

/** `×2 · $85.00 · -15%` back into qty / unit / discount (absent = blank). */
function splitMeta(meta: string): [string, string, string] {
  const [qty, ...rest] = meta.split(" · ");
  const unit = rest.find((p) => p.startsWith("$")) ?? "";
  const discount = rest.find((p) => !p.startsWith("$")) ?? "";
  return [qty.replace("×", ""), unit, discount];
}

/** The model's cell text with the view's one omission: the PDF's `-` ("nothing") is not shown. */
const asShown = (t: Tuple): Tuple => {
  const hide = (s: string) => (s === "-" ? "" : s);
  return [t[0], t[1], t[2], t[3], hide(t[4]), hide(t[5]), t[6], t[7]];
};

describe("Client view parity (view half)", () => {
  const view = clientViewOf(quoteLineItems());

  it("the fixture covers every case the gate names", () => {
    const rows = view.sections.flatMap((s) => s.rows);
    const lighting = view.sections.find((s) => s.title === "Lighting");
    expect(lighting?.rollupText).toBe("$1,680.00"); // 1020 + 200 + the revealed group's 460
    expect(lighting?.rows.find((r) => r.name === "MAC Aura PXL")?.total).toBe("$1,020.00"); // revealed line
    expect(lighting?.rows.find((r) => r.name === "Stage wash package")?.total).toBe("$460.00"); // revealed group
    expect(lighting?.rows.find((r) => r.name === "Source Four LED")).toMatchObject({ total: "", priceHidden: true });
    expect(view.sections.some((s) => s.title === "Uncategorized")).toBe(true);
    expect(rows.find((r) => r.name === "Lectern package")?.children.map((c) => c.name)).toEqual(["Timber lectern", "MX418 gooseneck"]);
    expect(rows.find((r) => r.name === "Lectern package")?.discount).toBe("-10%");
    expect(rows.find((r) => r.name === "Hazer MDG ATMe")?.isOptional).toBe(true);
    expect(rows.find((r) => r.name === "Axient AD4Q package")?.subtitle).toBe("via Scene Change");
    expect(rows.find((r) => r.name === "Shure SM58")?.total).toBe("$720.00");
    expect(rows.find((r) => r.name === "Confidence monitor rig")?.total).toBe("—");
    expect(view.sections.find((s) => s.title === "Services")?.rows.map((r) => r.name)).toEqual(["Audio engineer"]);
  });

  it("renders exactly the model's rows, in order, under the version's name", () => {
    const { container } = render(<EquipmentClientViewBody view={view} versionNumber={3} />);
    expect(domTuples(container)).toEqual(modelTuples(view).map(asShown));
    expect(container.textContent).toContain("Client view · v3");
  });

  it("never shows a line the quote never prints", () => {
    const { container } = render(<EquipmentClientViewBody view={view} />);
    for (const hidden of NEVER_PRINTED) expect(container.textContent, hidden).not.toContain(hidden);
  });
});
