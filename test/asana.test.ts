import { describe, expect, it } from "vitest";
import { AxiError } from "axi-sdk-js";
import { AsanaClient } from "../src/asana.js";
import {
  createFakeFetch,
  FAKE_TOKEN,
  type FakeRoute,
} from "./helpers/asanaFake.js";

function makeClient(routes: FakeRoute[], onRetry?: () => void): {
  client: AsanaClient;
  calls: ReturnType<typeof createFakeFetch>["calls"];
} {
  const fake = createFakeFetch(routes);
  return {
    client: new AsanaClient({
      token: FAKE_TOKEN,
      fetchImpl: fake.fetch,
      onRetry: onRetry ? () => onRetry() : undefined,
    }),
    calls: fake.calls,
  };
}

describe("AsanaClient.request", () => {
  it("unwraps the data envelope", async () => {
    const { client } = makeClient([
      { method: "GET", path: "users/me", respond: () => ({ gid: "1", name: "n" }) },
    ]);
    const data = await client.request<{ gid: string }>("GET", "/users/me");
    expect(data).toEqual({ gid: "1", name: "n" });
  });

  it("wraps bodies in { data: ... } and sends Bearer auth", async () => {
    const { client, calls } = makeClient([
      { method: "POST", path: "tasks", respond: () => ({ gid: "9" }) },
    ]);
    await client.request("POST", "/tasks", { body: { name: "x" } });
    const call = calls[0];
    expect(call?.body).toEqual({ name: "x" });
  });

  it("maps 401 to AUTH_REQUIRED with PAT guidance", async () => {
    const { client } = makeClient([
      {
        method: "GET",
        path: "users/me",
        respond: () => ({
          status: 401,
          body: { errors: [{ message: "Not Authorized" }] },
        }),
      },
    ]);
    await expect(client.request("GET", "/users/me")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("maps 404 to NOT_FOUND", async () => {
    const { client } = makeClient([
      {
        method: "GET",
        path: "tasks/1200000000000999",
        respond: () => ({
          status: 404,
          body: { errors: [{ message: "task: Not Found" }] },
        }),
      },
    ]);
    await expect(
      client.request("GET", "/tasks/1200000000000999"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("scrubs the token from error messages (redaction guarantee)", async () => {
    const { client } = makeClient([
      {
        method: "GET",
        path: "users/me",
        respond: () => ({
          status: 400,
          body: { errors: [{ message: `bad input ${FAKE_TOKEN}` }] },
        }),
      },
    ]);
    try {
      await client.request("GET", "/users/me");
      expect.unreachable();
    } catch (error) {
      const message = (error as AxiError).message;
      expect(message).not.toContain(FAKE_TOKEN);
      expect(message).toContain("***");
    }
  });

  it("retries 429 honoring Retry-After, then succeeds", async () => {
    let hits = 0;
    const { client } = makeClient([
      {
        method: "GET",
        path: "users/me",
        respond: () => {
          hits += 1;
          if (hits === 1) {
            return { status: 429, body: { errors: [{ message: "limit" }] } };
          }
          return { gid: "1" };
        },
      },
    ]);
    const data = await client.request("GET", "/users/me");
    expect(data).toEqual({ gid: "1" });
    expect(hits).toBe(2);
  });
});

describe("AsanaClient.collect", () => {
  it("follows next_page offsets and caps at limit", async () => {
    const pages = new Map<string, string[]>([
      ["", ["a", "b", "c"]],
      ["offset-1", ["d", "e"]],
    ]);
    const { client } = makeClient([
      {
        method: "GET",
        path: "tasks",
        respond: ({ query }) => {
          const offset = query.get("offset") ?? "";
          const items = pages.get(offset) ?? [];
          const next = offset === "" ? "offset-1" : null;
          return next
            ? { data: items, next_page: { offset: next } }
            : { data: items };
        },
      },
    ]);
    const result = await client.collect<string>("tasks", { limit: 4 });
    expect(result.items).toEqual(["a", "b", "c", "d"]);
    expect(result.hasMore).toBe(true);

    const all = await client.collect<string>("tasks", { limit: 10 });
    expect(all.items).toEqual(["a", "b", "c", "d", "e"]);
    expect(all.hasMore).toBe(false);
  });

  it("requests opt_fields and limit=100 page size", async () => {
    const { client, calls } = makeClient([
      { method: "GET", path: "tasks", respond: () => [] },
    ]);
    await client.collect("tasks", { query: { opt_fields: "gid,name" } });
    const call = calls[0];
    expect(call?.query.get("opt_fields")).toBe("gid,name");
    expect(call?.query.get("limit")).toBe("100");
    expect(call?.query.get("offset")).toBeNull();
  });
});
