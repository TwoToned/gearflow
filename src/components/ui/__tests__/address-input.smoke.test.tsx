// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createFakeMapsPlaces } from "@/lib/maps-fake";

// AddressInput gates autocomplete on useMapsLibrary("places") resolving truthy
// (the real SDK loader). The fake below stands in for `google.maps.places`
// itself, so the hook just needs to report "ready".
vi.mock("@/lib/maps-sdk", () => ({
  useMapsLibrary: () => ({}),
}));

import { AddressInput } from "@/components/ui/address-input";

/**
 * The Maps/Places adapter previously had no fake, so AddressInput had zero test
 * coverage (POLICY.md R-8.10.4). `createFakeMapsPlaces` stubs the
 * `google.maps.places` surface the component calls directly, exercising the
 * real autocomplete → select → Zod-validate path end to end.
 */
describe("AddressInput smoke", () => {
  const fake = createFakeMapsPlaces();
  let restore: () => void;

  beforeEach(() => {
    restore = fake.install();
    fake.setPredictions([
      {
        placeId: "place-1",
        mainText: "123 Example St",
        secondaryText: "Sydney NSW",
        fullText: "123 Example St, Sydney NSW",
        formattedAddress: "123 Example St, Sydney NSW, Australia",
        latitude: -33.87,
        longitude: 151.21,
      },
    ]);
  });

  afterEach(() => {
    restore();
  });

  it("renders without throwing", () => {
    expect(() =>
      render(<AddressInput value="" onChange={() => {}} />),
    ).not.toThrow();
  });

  it("typing shows predictions and selecting one calls onPlaceSelect with a validated place", async () => {
    const onChange = vi.fn();
    const onPlaceSelect = vi.fn();
    render(<AddressInput value="" onChange={onChange} onPlaceSelect={onPlaceSelect} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "123 Example" } });

    const option = await waitFor(() => screen.getByText("123 Example St"));
    fireEvent.mouseDown(option);

    await waitFor(() => expect(onPlaceSelect).toHaveBeenCalledTimes(1));
    expect(onPlaceSelect).toHaveBeenCalledWith({
      address: "123 Example St, Sydney NSW, Australia",
      latitude: -33.87,
      longitude: 151.21,
      placeId: "place-1",
    });
    expect(onChange).toHaveBeenCalledWith("123 Example St, Sydney NSW, Australia");
  });

  it("falls back to prediction text when the Place has no valid location", async () => {
    fake.setPredictions([
      {
        placeId: "place-2",
        mainText: "Somewhere Unresolvable",
        fullText: "Somewhere Unresolvable",
        formattedAddress: "",
        latitude: Number.NaN,
        longitude: Number.NaN,
      },
    ]);
    const onChange = vi.fn();
    const onPlaceSelect = vi.fn();
    render(<AddressInput value="" onChange={onChange} onPlaceSelect={onPlaceSelect} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Somewhere" } });

    const option = await waitFor(() => screen.getByText("Somewhere Unresolvable"));
    fireEvent.mouseDown(option);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("Somewhere Unresolvable"));
    expect(onPlaceSelect).not.toHaveBeenCalled();
  });
});
