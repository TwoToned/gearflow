// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

describe("Tabs — mobile overflow", () => {
  it("makes the tab list scroll sideways instead of clipping, with tabs that keep their size", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Equipment</TabsTrigger>
          <TabsTrigger value="b">Labour &amp; logistics</TabsTrigger>
          <TabsTrigger value="c">Financials</TabsTrigger>
          <TabsTrigger value="d">Tasks</TabsTrigger>
          <TabsTrigger value="e">Notes</TabsTrigger>
          <TabsTrigger value="f">Files</TabsTrigger>
        </TabsList>
        <TabsContent value="a">a</TabsContent>
      </Tabs>,
    );

    const list = screen.getByRole("tablist");
    expect(list.className).toContain("overflow-x-auto");
    expect(list.className).toContain("max-w-full");

    // Triggers keep their size and never wrap, so the row scrolls rather than reflowing.
    const tab = screen.getByRole("tab", { name: "Labour & logistics" });
    expect(tab.className).toContain("shrink-0");
    expect(tab.className).toContain("whitespace-nowrap");
  });
});
