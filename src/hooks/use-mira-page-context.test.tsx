// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import MiraContextProvider, { useMira } from "@/components/providers/mira-context-provider";
import { useMiraPageContext } from "./use-mira-page-context";

function Probe({ entityId }: { entityId: string | null }) {
  useMiraPageContext(entityId ? { entityType: "project", entityId } : null);
  return null;
}

function Reader() {
  const mira = useMira();
  return <div data-testid="ctx">{JSON.stringify(mira?.pageContext)}</div>;
}

describe("useMiraPageContext", () => {
  it("publishes the page context into the Mira provider", () => {
    const { getByTestId } = render(
      <MiraContextProvider>
        <Probe entityId="proj_1" />
        <Reader />
      </MiraContextProvider>,
    );
    expect(getByTestId("ctx").textContent).toBe(JSON.stringify({ entityType: "project", entityId: "proj_1" }));
  });

  it("clears the context when the publishing component unmounts", () => {
    function Wrapper({ mounted }: { mounted: boolean }) {
      return (
        <MiraContextProvider>
          {mounted && <Probe entityId="proj_1" />}
          <Reader />
        </MiraContextProvider>
      );
    }
    const { getByTestId, rerender } = render(<Wrapper mounted={true} />);
    expect(getByTestId("ctx").textContent).not.toBe("null");

    rerender(<Wrapper mounted={false} />);
    expect(getByTestId("ctx").textContent).toBe("null");
  });

  it("is a no-op when rendered without a MiraContextProvider", () => {
    expect(() => render(<Probe entityId="proj_1" />)).not.toThrow();
  });
});
