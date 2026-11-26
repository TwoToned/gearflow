import { describe, it, expect } from "vitest";

import { buildModelPageActions, type ModelPageCtx } from "./model";
import { modelLabels } from "../model-labels";

const all: ModelPageCtx = { onNewAsset: () => {}, onEdit: () => {}, onDuplicate: () => {}, onPrintLabels: () => {}, onArchive: () => {}, onRestore: () => {} };
const keys = (isActive: boolean | undefined, ctx: ModelPageCtx = all, labelCount = 3) => buildModelPageActions({ name: "Aura", isActive, labelCount }, ctx).items.map((i) => i.key);

describe("buildModelPageActions", () => {
  it("an active model offers Archive (last, red, confirmed) and never Restore", () => {
    expect(keys(true)).toEqual(["new-asset", "edit", "duplicate", "print-labels", "archive"]);
    const archive = buildModelPageActions({ name: "Aura", isActive: true, labelCount: 1 }, all).items.at(-1)!;
    expect(archive.danger).toBe(true);
    expect(archive.confirm?.confirmLabel).toBe("Archive model");
  });

  it("an archived model offers Restore (reachable) and no Archive or New asset", () => {
    expect(keys(false)).toEqual(["edit", "duplicate", "print-labels", "restore"]);
  });

  it("a verb without its handler is absent, and Print labels is absent with nothing to print", () => {
    expect(keys(true, { ...all, onEdit: undefined, onArchive: undefined, onDuplicate: undefined }, 0)).toEqual(["new-asset"]);
  });
});

describe("modelLabels", () => {
  it("lists live serialised units and bulk tags in tag order, leaving retired and inactive out", () => {
    const labels = modelLabels(
      "Aura",
      [{ assetTag: "AURA-10" }, { assetTag: "AURA-2", customName: "Spare" }, { assetTag: "AURA-3", status: "RETIRED" }, { assetTag: "AURA-4", isActive: false }],
      [{ assetTag: "AURA-B1", totalQuantity: 6 }],
    );
    expect(labels.map((l) => l.tag)).toEqual(["AURA-2", "AURA-10", "AURA-B1"]);
    expect(labels[0].caption).toBe("Spare");
    expect(labels[2]).toMatchObject({ kind: "bulk", caption: "Aura · bulk × 6" });
  });
});
