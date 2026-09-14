import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import { mapAsanaHttpError, networkError, rateLimitedError } from "./errors.js";
import { redact } from "./config.js";

/**
 * Asana REST v1 client (https://developers.asana.com/reference). One class,
 * no runtime dependencies beyond Node's global fetch.
 *
 * Behavior:
 * - Every response body is `{ data: ..., next_page: { offset } | null }`.
 * - `collect()` follows `next_page.offset` until the caller's item cap is
 *   reached, and reports `hasMore` so list output stays honest (Asana has no
 *   total-count endpoint; `count` = items actually returned).
 * - 429/503 responses retry up to 3 times honoring `Retry-After` (seconds).
 * - All error text is scrubbed through `redact()` so the bearer token can
 *   never appear in output even if an upstream error echoed it.
 */

export const ASANA_API_BASE = "https://app.asana.com/api/1.0";
const PAGE_SIZE = 100;
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 30_000;

export type FetchLike = typeof fetch;

export interface AsanaClientOptions {
  token: string;
  fetchImpl?: FetchLike;
  apiBase?: string;
  /** Retry notifications (default: stderr - debug output, never stdout). */
  onRetry?: (info: { attempt: number; waitMs: number }) => void;
}

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

export interface CollectOptions extends RequestOptions {
  /** Max items to return (default 30). */
  limit?: number;
}

export interface CollectResult<T> {
  items: T[];
  hasMore: boolean;
}

interface AsanaEnvelope {
  data?: unknown;
  next_page?: { offset?: string; path?: string; uri?: string } | null;
}

function defaultOnRetry(info: { attempt: number; waitMs: number }): void {
  process.stderr.write(
    `asana-axi: rate limited, retrying in ${Math.round(info.waitMs / 100) / 10}s (attempt ${info.attempt}/${MAX_RETRIES})\n`,
  );
}

export class AsanaClient {
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly apiBase: string;
  private readonly onRetry: (info: { attempt: number; waitMs: number }) => void;

  constructor(options: AsanaClientOptions) {
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBase = options.apiBase ?? ASANA_API_BASE;
    this.onRetry = options.onRetry ?? defaultOnRetry;
  }

  /**
   * Perform one API request and return the full envelope (data + next_page).
   * Retries 429/503 with Retry-After; throws AxiError on other failures.
   */
  private async requestEnvelope(
    method: string,
    path: string,
    options: RequestOptions = {},
    raw?: { boundary: string; body: Uint8Array },
  ): Promise<AsanaEnvelope> {
    const url = this.buildUrl(path, options.query);
    let attempt = 0;
    // Bounded retry loop: each iteration either returns, sleeps, or throws.
    for (;;) {
      const init: RequestInit = {
        method,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: raw
          ? {
              Authorization: `Bearer ${this.token}`,
              "Content-Type": `multipart/form-data; boundary=${raw.boundary}`,
            }
          : {
              Authorization: `Bearer ${this.token}`,
              ...(options.body !== undefined
                ? { "Content-Type": "application/json" }
                : {}),
            },
      };
      if (raw) {
        init.body = raw.body as unknown as RequestInit["body"];
      } else if (options.body !== undefined) {
        init.body = JSON.stringify({ data: options.body });
      }

      let response: Response;
      try {
        response = await this.fetchImpl(url, init);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw networkError(redact(message, this.token));
      }

      if (response.status === 429 || response.status === 503) {
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        if (attempt < MAX_RETRIES) {
          attempt += 1;
          this.onRetry({ attempt, waitMs: retryAfter });
          await sleep(retryAfter);
          continue;
        }
        throw rateLimitedError(retryAfter / 1000);
      }

      if (!response.ok) {
        throw await this.httpError(response, method, path);
      }

      if (response.status === 204) {
        return {};
      }
      const text = await response.text();
      try {
        const envelope = JSON.parse(text) as AsanaEnvelope;
        return envelope;
      } catch {
        throw networkError(
          `unexpected non-JSON response from ${path} (${response.status})`,
        );
      }
    }
  }

  /**
   * Perform one API request and return the parsed `data` payload.
   * Retries 429/503 with Retry-After; throws AxiError on other failures.
   */
  async request<T = unknown>(
    method: string,
    path: string,
    options: RequestOptions = {},
    raw?: { boundary: string; body: Uint8Array },
  ): Promise<T> {
    const envelope = await this.requestEnvelope(method, path, options, raw);
    return (envelope.data ?? undefined) as T;
  }

  /**
   * Fetch one page (data + next_page offset) - used by `collect`.
   */
  async requestPage<T = unknown>(
    path: string,
    options: RequestOptions = {},
    offset?: string,
  ): Promise<{ data: T[]; nextPageOffset: string | null }> {
    const query: Record<string, string | number | boolean | undefined> = {
      ...options.query,
      limit: PAGE_SIZE,
      ...(offset !== undefined ? { offset } : {}),
    };
    const envelope = await this.requestEnvelope("GET", path, { query });
    const data = Array.isArray(envelope?.data) ? envelope.data : [];
    const nextPageOffset =
      envelope?.next_page?.offset !== undefined &&
      envelope.next_page.offset !== null
        ? envelope.next_page.offset
        : null;
    return { data, nextPageOffset };
  }

  /** Collect items across pages, capped at `limit` (default 30). */
  async collect<T = unknown>(
    path: string,
    options: CollectOptions = {},
  ): Promise<CollectResult<T>> {
    const limit = options.limit ?? 30;
    const items: T[] = [];
    let offset: string | undefined;
    let hasMore = false;

    while (items.length < limit) {
      const page: { data: T[]; nextPageOffset: string | null } =
        await this.requestPage<T>(path, options, offset);
      items.push(...page.data);
      if (page.nextPageOffset === null) {
        hasMore = false;
        break;
      }
      offset = page.nextPageOffset;
      hasMore = true;
    }

    if (items.length > limit) {
      items.length = limit;
      hasMore = true;
    }
    return { items, hasMore };
  }

  /** Upload a local file as a task attachment (multipart POST /attachments). */
  async attach(
    taskGid: string,
    filePath: string,
  ): Promise<Record<string, unknown>> {
    const bytes = new Uint8Array(await readFile(filePath));
    const contentType = guessContentType(filePath);
    const boundary = `asana-axi-${randomUUID().replace(/-/g, "")}`;
    const name = basename(filePath);
    const encoder = new TextEncoder();

    const head: Uint8Array[] = [
      encoder.encode(`--${boundary}\r\n`),
      encoder.encode(
        `Content-Disposition: form-data; name="parent"\r\n\r\n${taskGid}\r\n`,
      ),
      encoder.encode(`--${boundary}\r\n`),
      encoder.encode(
        `Content-Disposition: form-data; name="file"; filename="${sanitizeFilename(name)}"\r\n`,
      ),
      encoder.encode(`Content-Type: ${contentType}\r\n\r\n`),
    ];
    const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
    const total = head.reduce((sum, part) => sum + part.byteLength, 0) +
      bytes.byteLength + tail.byteLength;
    const body = new Uint8Array(total);
    let cursor = 0;
    for (const part of [...head, bytes, tail]) {
      body.set(part, cursor);
      cursor += part.byteLength;
    }

    return this.request<Record<string, unknown>>(
      "POST",
      "/attachments",
      {},
      { boundary, body },
    );
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const base = `${this.apiBase}/${path.replace(/^\//, "")}`;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== "") {
        params.set(key, String(value));
      }
    }
    const qs = params.toString();
    return qs === "" ? base : `${base}?${qs}`;
  }

  private async httpError(
    response: Response,
    method: string,
    path: string,
  ): Promise<Error> {
    const text = await response.text();
    let messages: string[] = [];
    try {
      const parsed = JSON.parse(text) as {
        errors?: { message?: string }[];
      };
      messages = (parsed.errors ?? [])
        .map((error) => error.message ?? "")
        .filter((message) => message !== "");
    } catch {
      // Non-JSON error body: fall through to the status-based message.
    }
    if (messages.length === 0) {
      messages = [`${method} ${path} failed with HTTP ${response.status}`];
    }
    const error = mapAsanaHttpError(
      response.status,
      messages.map((message) => redact(message, this.token)),
      path,
    );
    return error;
  }
}

function parseRetryAfter(header: string | null): number {
  if (header === null) return 1000;
  const seconds = Number.parseFloat(header);
  if (!Number.isFinite(seconds) || seconds < 0) return 1000;
  return Math.min(Math.ceil(seconds * 1000), 30_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function guessContentType(filePath: string): string {
  const lower = filePath.toLowerCase();
  const table: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".csv": "text/csv",
    ".log": "text/plain",
    ".zip": "application/zip",
    ".html": "text/html",
  };
  for (const [extension, type] of Object.entries(table)) {
    if (lower.endsWith(extension)) return type;
  }
  return "application/octet-stream";
}

function sanitizeFilename(name: string): string {
  // Header values must stay ASCII and quote-free.
  return name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
}
