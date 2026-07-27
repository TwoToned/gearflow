import { describe, expect, it } from "vitest";
import {
  resolveEquipmentAccountCode,
  resolveModelOrKitAccountCode,
  resolveServiceAccountCode,
  resolveTaxType,
  serviceAccountDefaultKeyForType,
} from "./xeroAccountCascade";

describe("resolveModelOrKitAccountCode", () => {
  it("kit-parent line reads the kit code, never the model code", () => {
    expect(
      resolveModelOrKitAccountCode({
        isKitParent: true,
        lineKind: "RENTAL",
        kitCode: "4100",
        modelRentalCode: "4200",
        modelSaleCode: "4300",
      }),
    ).toBe("4100");
  });

  it("kit-parent line with no kit code resolves to null (falls through to category)", () => {
    expect(
      resolveModelOrKitAccountCode({
        isKitParent: true,
        lineKind: "RENTAL",
        kitCode: undefined,
        modelRentalCode: "4200",
      }),
    ).toBeNull();
  });

  it("plain rental line reads the model's rental code", () => {
    expect(
      resolveModelOrKitAccountCode({
        isKitParent: false,
        lineKind: "RENTAL",
        modelRentalCode: "4200",
        modelSaleCode: "4300",
      }),
    ).toBe("4200");
  });

  it("sale-kind line reads the model's sale code, not rental", () => {
    expect(
      resolveModelOrKitAccountCode({
        isKitParent: false,
        lineKind: "SALE",
        modelRentalCode: "4200",
        modelSaleCode: "4300",
      }),
    ).toBe("4300");
  });

  it("sale-kind line with no sale code set resolves to null", () => {
    expect(
      resolveModelOrKitAccountCode({
        isKitParent: false,
        lineKind: "SALE",
        modelRentalCode: "4200",
        modelSaleCode: undefined,
      }),
    ).toBeNull();
  });
});

describe("resolveEquipmentAccountCode — 4-level cascade", () => {
  const allLevels = {
    lineOverride: "L1",
    modelOrKitCode: "L2",
    categoryCode: "L3",
    orgDefaultCode: "L4",
  };

  it("level 1 (line override) wins when present", () => {
    expect(resolveEquipmentAccountCode(allLevels)).toBe("L1");
  });

  it("falls to level 2 (model/kit) when no line override", () => {
    expect(resolveEquipmentAccountCode({ ...allLevels, lineOverride: undefined })).toBe("L2");
  });

  it("falls to level 3 (category) when levels 1-2 absent", () => {
    expect(
      resolveEquipmentAccountCode({ ...allLevels, lineOverride: undefined, modelOrKitCode: null }),
    ).toBe("L3");
  });

  it("falls to level 4 (org default) when levels 1-3 absent", () => {
    expect(
      resolveEquipmentAccountCode({
        lineOverride: undefined,
        modelOrKitCode: null,
        categoryCode: undefined,
        orgDefaultCode: "L4",
      }),
    ).toBe("L4");
  });

  it("resolves to null when every level is absent", () => {
    expect(
      resolveEquipmentAccountCode({
        lineOverride: null,
        modelOrKitCode: null,
        categoryCode: null,
        orgDefaultCode: null,
      }),
    ).toBeNull();
  });

  it("treats an empty-string override as absent, not a real value", () => {
    expect(resolveEquipmentAccountCode({ ...allLevels, lineOverride: "  " })).toBe("L2");
  });
});

describe("resolveServiceAccountCode — 3-level cascade", () => {
  it("line override wins", () => {
    expect(
      resolveServiceAccountCode({ lineOverride: "S1", serviceTypeDefault: "S2", orgDefaultCode: "S3" }),
    ).toBe("S1");
  });

  it("falls to the service-type default", () => {
    expect(
      resolveServiceAccountCode({ lineOverride: undefined, serviceTypeDefault: "S2", orgDefaultCode: "S3" }),
    ).toBe("S2");
  });

  it("falls to the org default when no service-type default is configured", () => {
    expect(
      resolveServiceAccountCode({ lineOverride: undefined, serviceTypeDefault: undefined, orgDefaultCode: "S3" }),
    ).toBe("S3");
  });

  it("resolves to null when nothing is configured", () => {
    expect(resolveServiceAccountCode({})).toBeNull();
  });
});

describe("resolveTaxType", () => {
  it("per-line override wins over the org default", () => {
    expect(resolveTaxType({ lineOverride: "GST", orgDefaultTaxType: "OUTPUT2" })).toBe("GST");
  });

  it("falls to the org default when unset", () => {
    expect(resolveTaxType({ lineOverride: undefined, orgDefaultTaxType: "OUTPUT2" })).toBe("OUTPUT2");
  });

  it("resolves to null when neither is set", () => {
    expect(resolveTaxType({})).toBeNull();
  });
});

describe("serviceAccountDefaultKeyForType — rental-vs-sale-adjacent branch coverage", () => {
  it("maps LABOUR to the LABOUR bucket", () => {
    expect(serviceAccountDefaultKeyForType("LABOUR")).toBe("LABOUR");
  });

  it.each(["DELIVERY", "PICKUP", "BUMP_IN", "BUMP_OUT"])(
    "maps %s to the DELIVERY_TRANSPORT bucket",
    (type) => {
      expect(serviceAccountDefaultKeyForType(type)).toBe("DELIVERY_TRANSPORT");
    },
  );

  it("maps MISC and any unrecognised type to the MISC bucket", () => {
    expect(serviceAccountDefaultKeyForType("MISC")).toBe("MISC");
    expect(serviceAccountDefaultKeyForType("SOME_FUTURE_TYPE")).toBe("MISC");
  });
});
