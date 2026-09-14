import { describe, expect, it } from "vitest";
import { AxiError } from "axi-sdk-js";
import {
  closest,
  parseFlags,
  parseLimit,
  splitCsv,
  unknownSubcommandError,
} from "../src/args.js";

describe("parseFlags", () => {
  it("parses --flag value and positionals", () => {
    const parsed = parseFlags(
      ["view", "1201", "--full"],
      { "--full": "boolean", "--limit": "value" },
      "task view",
    );
    expect(parsed.positionals).toEqual(["view", "1201"]);
    expect(parsed.flags["--full"]).toBe(true);
  });

  it("parses --flag=value form", () => {
    const parsed = parseFlags(
      ["--limit=50"],
      { "--limit": "value" },
      "task list",
    );
    expect(parsed.flags["--limit"]).toBe("50");
  });

  it("treats everything after -- as positional", () => {
    const parsed = parseFlags(
      ["search", "--", "--not-a-flag"],
      { "--workspace": "value" },
      "task search",
    );
    expect(parsed.positionals).toEqual(["search", "--not-a-flag"]);
  });

  it("fails loud on unknown flags with exit code 2 semantics", () => {
    try {
      parseFlags(["--nope"], {}, "task list");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      expect((error as AxiError).code).toBe("VALIDATION_ERROR");
      expect((error as AxiError).message).toContain("--nope");
    }
  });

  it("rejects booleans given a non-boolean =value", () => {
    expect(() =>
      parseFlags(["--full=maybe"], { "--full": "boolean" }, "task view"),
    ).toThrow(/boolean/);
  });

  it("rejects value flags without a value", () => {
    expect(() =>
      parseFlags(["--limit"], { "--limit": "value" }, "task list"),
    ).toThrow(/requires a value/);
  });
});

describe("parseLimit", () => {
  it("defaults when absent", () => {
    expect(parseLimit({}, 30)).toBe(30);
  });
  it("accepts integers 1..500", () => {
    expect(parseLimit({ "--limit": "1" }, 30)).toBe(1);
    expect(parseLimit({ "--limit": "500" }, 30)).toBe(500);
  });
  it("rejects garbage and out-of-range", () => {
    expect(() => parseLimit({ "--limit": "x" }, 30)).toThrow(AxiError);
    expect(() => parseLimit({ "--limit": "0" }, 30)).toThrow(AxiError);
    expect(() => parseLimit({ "--limit": "501" }, 30)).toThrow(AxiError);
  });
});

describe("splitCsv", () => {
  it("splits, trims, and drops empties", () => {
    expect(splitCsv(" a , b ,, ")).toEqual(["a", "b"]);
    expect(splitCsv(undefined)).toEqual([]);
  });
});

describe("unknownSubcommandError", () => {
  it("suggests a close subcommand", () => {
    const error = unknownSubcommandError("task", "lst", ["list", "view"], "task");
    expect(error.message).toContain("lst");
    expect(error.suggestions.join(" ")).toContain("Did you mean `list`?");
  });
});

describe("closest", () => {
  it("finds near misses and stays quiet for far ones", () => {
    expect(closest("lst", ["list", "view"])).toBe("list");
    expect(closest("zzzzzzz", ["list", "view"])).toBeUndefined();
  });
});
