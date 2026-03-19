import { describe, it, expect } from "vitest";
import {
  buildTokenMap,
  resolveTokensInText,
  getAllowedTokens,
} from "./token-resolver";
import type { DocumentData } from "./types";

// Minimal DocumentData stub for testing
const sampleData = {
  org_name: "Acme Rentals",
  org_email: "info@acme.com",
  org_phone: "1300 123 456",
  org_address: "123 Main St, Sydney",
  org_website: "https://acme.com",
  org_tax_rate: 10,
  org_tax_label: "GST",
  org_document_color: "#0d9488",
  project_name: "Summer Festival",
  project_number: "PRJ-001",
  project_status: "CONFIRMED",
  project_type: "Festival",
  client_name: "Jane Smith",
  client_contact: "Jane Smith",
  client_email: "jane@example.com",
  client_phone: "",
  client_billing_address: "456 Client St",
  client_tax_id: "12345678901",
  client_payment_terms: "Net 30",
  rental_start: "15/03/2026",
  rental_end: "20/03/2026",
  event_start: "17/03/2026",
  event_end: "19/03/2026",
  load_in_date: "15/03/2026",
  load_out_date: "20/03/2026",
  venue_name: "Sydney Opera House",
  venue_address: "1 Circular Quay",
  site_contact_name: "John Doe",
  site_contact_phone: "0400 000 000",
  site_contact_email: "john@venue.com",
  subtotal: "$5,000.00",
  discount_percent: "10%",
  discount_amount: "$500.00",
  tax_label: "GST",
  tax_amount: "$450.00",
  total: "$4,950.00",
  deposit_paid: "$1,000.00",
  balance_due: "$3,950.00",
  client_notes: "Please deliver before 3pm",
  crew_notes: "Load in from rear entrance",
  internal_notes: "VIP client",
  document_date: "14/03/2026",
  total_items: "42",
  total_weight: "350 kg",
  // Non-flat fields that should be excluded
  line_items: [],
  org_logo_url: "https://example.com/logo.png",
  crew: [],
} as unknown as DocumentData;

// ---------------------------------------------------------------------------
// buildTokenMap
// ---------------------------------------------------------------------------
describe("buildTokenMap", () => {
  it("builds a flat map of allowed string fields", () => {
    const map = buildTokenMap(sampleData);
    expect(map.org_name).toBe("Acme Rentals");
    expect(map.client_name).toBe("Jane Smith");
    expect(map.total).toBe("$4,950.00");
  });

  it("converts numbers to strings", () => {
    const map = buildTokenMap(sampleData);
    expect(map.org_tax_rate).toBe("10");
  });

  it("excludes non-whitelisted fields", () => {
    const map = buildTokenMap(sampleData);
    expect(map).not.toHaveProperty("org_logo_url");
    expect(map).not.toHaveProperty("line_items");
    expect(map).not.toHaveProperty("crew");
  });

  it("excludes array and object values even if key is allowed", () => {
    const data = { ...sampleData, client_name: ["array"] } as unknown as DocumentData;
    const map = buildTokenMap(data);
    expect(map).not.toHaveProperty("client_name");
  });

  it("includes empty strings", () => {
    const map = buildTokenMap(sampleData);
    expect(map.client_phone).toBe("");
  });
});

// ---------------------------------------------------------------------------
// resolveTokensInText
// ---------------------------------------------------------------------------
describe("resolveTokensInText", () => {
  it("resolves a single token", () => {
    expect(resolveTokensInText("{client_name}", sampleData)).toBe("Jane Smith");
  });

  it("resolves multiple tokens in one string", () => {
    const result = resolveTokensInText("To: {client_name}, Project: {project_name}", sampleData);
    expect(result).toBe("To: Jane Smith, Project: Summer Festival");
  });

  it("replaces unknown tokens with empty string", () => {
    expect(resolveTokensInText("{unknown_field}", sampleData)).toBe("");
  });

  it("is case-insensitive", () => {
    expect(resolveTokensInText("{CLIENT_NAME}", sampleData)).toBe("Jane Smith");
    expect(resolveTokensInText("{Client_Name}", sampleData)).toBe("Jane Smith");
  });

  it("returns text unchanged when no tokens present", () => {
    expect(resolveTokensInText("Hello world", sampleData)).toBe("Hello world");
  });

  it("handles empty string input", () => {
    expect(resolveTokensInText("", sampleData)).toBe("");
  });

  it("handles adjacent tokens", () => {
    expect(resolveTokensInText("{org_name}{client_name}", sampleData)).toBe(
      "Acme RentalsJane Smith"
    );
  });

  it("preserves text between tokens", () => {
    expect(resolveTokensInText("Hi {client_name}! Your total is {total}.", sampleData)).toBe(
      "Hi Jane Smith! Your total is $4,950.00."
    );
  });

  it("handles curly braces without valid token syntax", () => {
    expect(resolveTokensInText("Price: ${100}", sampleData)).toBe("Price: ${100}");
  });
});

// ---------------------------------------------------------------------------
// getAllowedTokens
// ---------------------------------------------------------------------------
describe("getAllowedTokens", () => {
  it("returns categorized token list", () => {
    const groups = getAllowedTokens();
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0].category).toBeDefined();
    expect(groups[0].tokens.length).toBeGreaterThan(0);
  });

  it("each token has name and label", () => {
    const groups = getAllowedTokens();
    for (const group of groups) {
      for (const token of group.tokens) {
        expect(token.name).toBeTruthy();
        expect(token.label).toBeTruthy();
      }
    }
  });

  it("includes key tokens in the list", () => {
    const groups = getAllowedTokens();
    const allNames = groups.flatMap((g) => g.tokens.map((t) => t.name));
    expect(allNames).toContain("org_name");
    expect(allNames).toContain("client_name");
    expect(allNames).toContain("total");
    expect(allNames).toContain("project_name");
  });
});
