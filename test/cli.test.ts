import { describe, expect, it, vi } from "vitest";
import { main, renderUnknownCommand } from "../src/cli.js";

interface Captured {
  text: string;
  exitCode: number | undefined;
}

/**
 * Drive main() in-process: capture stdout writes and read process.exitCode
 * immediately after main() resolves (the SDK sets exitCode, never exits).
 */
async function runCli(argv: string[]): Promise<Captured> {
  const chunks: string[] = [];
  const write = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(((chunk: string) => {
      chunks.push(chunk);
      return true;
    }) as never);
  try {
    await main({ argv });
    const exitCode =
      typeof process.exitCode === "number" ? process.exitCode : undefined;
    return { text: chunks.join(""), exitCode };
  } finally {
    write.mockRestore();
    process.exitCode = undefined;
  }
}

describe("cli wiring", () => {
  it("serves per-resource --help from the registry", async () => {
    const { text } = await runCli(["task", "--help"]);
    expect(text).toContain("usage: asana-axi task");
    expect(text).toContain("subcommands[12]");
  });

  it("unknown commands exit 2 with a did-you-mean", async () => {
    const { text, exitCode } = await runCli(["taks"]);
    expect(text).toContain("Unknown command: taks");
    expect(text).toContain("Did you mean `asana-axi task`?");
    expect(exitCode).toBe(2);
  });

  it("unknown flag inside a resource exits 2", async () => {
    const { text, exitCode } = await runCli([
      "task",
      "list",
      "--project",
      "1200000000000200",
      "--wat",
    ]);
    expect(text).toContain("Unknown flag: --wat");
    expect(exitCode).toBe(2);
  });

  it("flags before the command are rejected by the SDK (exit 2)", async () => {
    const { exitCode } = await runCli(["--project", "1", "task"]);
    expect(exitCode).toBe(2);
  });
});

describe("renderUnknownCommand", () => {
  it("matches the SDK error shape on stdout", () => {
    expect(renderUnknownCommand("xyzzy")).toContain("Unknown command: xyzzy");
    expect(renderUnknownCommand("proj")).toContain("Did you mean `asana-axi project`?");
  });
});
