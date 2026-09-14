import { tryFastPath } from "axi-sdk-js/fast-path";
import { readNearestPackageJson } from "axi-sdk-js";
import { fileURLToPath } from "node:url";

// Fast path: answer bare -v/-V/--version without loading the command graph.
let version = "0.0.0";
try {
  version =
    readNearestPackageJson(fileURLToPath(import.meta.url)).version ?? "0.0.0";
} catch {
  // Fall back to the placeholder; runAxiCli reports "not configured" itself.
}
if (tryFastPath(process.argv.slice(2), { version })) {
  process.exit(0);
}

const { main } = await import("../cli.js");
const { AxiError, exitCodeForError } = await import("axi-sdk-js");

// Defense-in-depth: runAxiCli shapes command errors itself, but any
// rejection that escapes it would surface as an unhandled rejection with a
// raw stack. Catch here and render the same structured shape on stdout.
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof AxiError ? error.code : "UNKNOWN";
  const suggestions = error instanceof AxiError ? error.suggestions : [];
  const lines = [`error: ${message}`, `code: ${code}`];
  for (const suggestion of suggestions) {
    lines.push(`help: ${suggestion}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  process.exitCode = exitCodeForError(error);
});
