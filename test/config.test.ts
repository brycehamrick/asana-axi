import { describe, expect, it } from "vitest";
import { loadConfig, parseDotEnv, redact } from "../src/config.js";

describe("parseDotEnv", () => {
  it("parses KEY=VALUE pairs, comments, and quoted values", () => {
    const parsed = parseDotEnv(`
# comment
ASANA_ACCESS_TOKEN=abc123
QUOTED="with spaces"
SINGLE='single'
EMPTY=
`);
    expect(parsed).toEqual({
      ASANA_ACCESS_TOKEN: "abc123",
      QUOTED: "with spaces",
      SINGLE: "single",
      EMPTY: "",
    });
  });
});

describe("loadConfig", () => {
  it("requires a token from env or .env", () => {
    expect(() =>
      loadConfig({ env: {}, readFile: () => undefined }),
    ).toThrow(/ASANA_ACCESS_TOKEN/);
  });

  it("prefers real environment over .env values", () => {
    const config = loadConfig({
      env: { ASANA_ACCESS_TOKEN: "from-env", ASANA_PROJECT_ID: "111111111111" },
      readFile: () =>
        "ASANA_ACCESS_TOKEN=from-file\nASANA_WORKSPACE_ID=222222222222",
    });
    expect(config.token).toBe("from-env");
    expect(config.projectId).toBe("111111111111");
    expect(config.workspaceId).toBe("222222222222");
  });

  it("falls back to .env when the environment is empty", () => {
    const config = loadConfig({
      env: {},
      readFile: () => "ASANA_ACCESS_TOKEN=from-file",
    });
    expect(config.token).toBe("from-file");
  });

  it("treats empty-string env vars as unset (uses .env instead)", () => {
    const config = loadConfig({
      env: { ASANA_ACCESS_TOKEN: "" },
      readFile: () => "ASANA_ACCESS_TOKEN=from-file",
    });
    expect(config.token).toBe("from-file");
  });

  it("omits optional GIDs when neither source has them", () => {
    const config = loadConfig({
      env: { ASANA_ACCESS_TOKEN: "tok" },
      readFile: () => undefined,
    });
    expect(config).toEqual({ token: "tok" });
  });
});

describe("redact", () => {
  it("scrubs the token from any text", () => {
    expect(redact("Bearer secret-token-value here", "secret-token-value")).toBe(
      "Bearer *** here",
    );
  });

  it("leaves text alone when the secret is too short to be safe", () => {
    expect(redact("short", "short")).toBe("short");
  });
});
