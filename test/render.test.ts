import { describe, expect, it } from "vitest";
import {
  dateOnly,
  isGid,
  isOverdue,
  stripNulls,
  taskUrl,
  truncate,
} from "../src/render.js";

describe("stripNulls", () => {
  it("drops null/undefined but keeps 0, false, and empty arrays", () => {
    expect(
      stripNulls({
        count: 0,
        flag: false,
        list: [],
        gone: null,
        alsoGone: undefined,
        nested: { a: null, b: 1 },
      }),
    ).toEqual({ count: 0, flag: false, list: [], nested: { b: 1 } });
  });
});

describe("truncate", () => {
  it("passes short text through unchanged", () => {
    expect(truncate("short", 100, false, "--full")).toBe("short");
  });
  it("appends the AXI size-hint marker with full length and escape hatch", () => {
    const text = "x".repeat(1500);
    const result = truncate(text, 1000, false, "--full");
    expect(result).toContain("...(truncated, 1500 chars total - use --full");
    expect(result.length).toBeLessThan(text.length);
  });
  it("--full bypasses truncation", () => {
    const text = "x".repeat(1500);
    expect(truncate(text, 1000, true, "--full")).toBe(text);
  });
});

describe("dateOnly", () => {
  it("extracts YYYY-MM-DD from full timestamps and passes dates through", () => {
    expect(dateOnly("2026-09-14T10:00:00.000Z")).toBe("2026-09-14");
    expect(dateOnly("2026-09-14")).toBe("2026-09-14");
    expect(dateOnly(null)).toBeNull();
    expect(dateOnly("")).toBeNull();
  });
});

describe("isGid", () => {
  it("accepts long numeric strings only", () => {
    expect(isGid("1200000000000401")).toBe(true);
    expect(isGid("123")).toBe(false);
    expect(isGid("Website")).toBe(false);
  });
});

describe("isOverdue", () => {
  it("compares against today (UTC)", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(isOverdue("2000-01-01")).toBe(true);
    expect(isOverdue(today)).toBe(false);
    expect(isOverdue(null)).toBe(false);
  });
});

describe("taskUrl", () => {
  it("builds the canonical browser URL", () => {
    expect(taskUrl("1200000000000401")).toBe(
      "https://app.asana.com/0/0/1200000000000401/f",
    );
  });
});
