/**
 * Output-shaping helpers shared by every command: token-lean objects
 * (nulls stripped, 0/[]/false always preserved for definitive empty states),
 * content truncation with escape-hint markers, and date normalization.
 */

export const NOTES_TRUNCATE_LENGTH = 1000;
export const COMMENT_TRUNCATE_LENGTH = 500;

/** Recursively drop null/undefined values; keep 0, false, and empty arrays. */
export function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripNulls(item)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === null || entry === undefined) continue;
      out[key] = stripNulls(entry);
    }
    return out as T;
  }
  return value;
}

/**
 * Truncate long free text with the AXI size-hint marker. `full` bypasses.
 * Multi-line text collapses to a single-line summary token-wise (TOON renders
 * newlines as escapes anyway); pass `preserveLines` to keep them.
 */
export function truncate(
  text: string,
  maxLength: number,
  full: boolean,
  fullFlag: string,
): string {
  if (full || text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength);
  return `${clipped}...(truncated, ${text.length} chars total - use ${fullFlag} to see complete text)`;
}

/** Asana timestamps arrive as ISO strings; render as YYYY-MM-DD, null-safe. */
export function dateOnly(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? (match[1] as string) : null;
}

/** Canonical browser URL for a task GID. */
export function taskUrl(gid: string): string {
  return `https://app.asana.com/0/0/${gid}/f`;
}

/** Structured output shape the SDK TOON-serializes (local mirror of the SDK's). */
export type AxiStructuredOutput = Record<string, unknown>;

/** True when a date-only string is strictly before today (UTC). */
export function isOverdue(dueOn: string | null): boolean {
  if (!dueOn) return false;
  const today = new Date().toISOString().slice(0, 10);
  return dueOn < today;
}

/** Map an Asana task record to the default 5-column list row. */
export interface TaskListRow {
  gid: string;
  name: string;
  section: string | null;
  due_on: string | null;
  completed: boolean;
}

export function taskListRow(task: TaskRecord): TaskListRow {
  return {
    gid: gidOf(task),
    name: nameOf(task),
    section: sectionNameOf(task),
    due_on: dateOnly(task.due_on ?? task.due_at),
    completed: task.completed === true,
  };
}

// ---------------------------------------------------------------------------
// Tolerant accessors over Asana's JSON shape (defensive: API drift degrades
// to nulls instead of crashes; fixtures in test/ pin the expected shape).
// ---------------------------------------------------------------------------

// Tolerant record aliases over Asana's JSON payloads (defensive: API drift
// degrades to nulls instead of crashes; fixtures in test/ pin the shape).
export type JsonRecord = Record<string, any>;

export type TaskRecord = JsonRecord;
export type ProjectRecord = JsonRecord;
export type WorkspaceRecord = JsonRecord;
export type SectionRecord = JsonRecord;
export type TagRecord = JsonRecord;
export type UserRecord = JsonRecord;
export type StoryRecord = JsonRecord;
export type AttachmentRecord = JsonRecord;

export function gidOf(record: JsonRecord): string {
  return String(record.gid ?? "");
}

export function nameOf(record: JsonRecord): string {
  return typeof record.name === "string" ? record.name : "";
}

export function sectionNameOf(task: TaskRecord): string | null {
  const memberships = task.memberships;
  if (!Array.isArray(memberships) || memberships.length === 0) return null;
  const first = memberships[0] as JsonRecord | undefined;
  const section = first?.section as JsonRecord | undefined;
  return section && typeof section.name === "string" ? section.name : null;
}

export function sectionGidOf(task: TaskRecord): string | null {
  const memberships = task.memberships;
  if (!Array.isArray(memberships) || memberships.length === 0) return null;
  const first = memberships[0] as JsonRecord | undefined;
  const section = first?.section as JsonRecord | undefined;
  return section?.gid ? String(section.gid) : null;
}

export function assigneeNameOf(task: TaskRecord): string | null {
  const assignee = task.assignee as JsonRecord | null | undefined;
  if (!assignee || typeof assignee !== "object") return null;
  return typeof assignee.name === "string" ? assignee.name : null;
}

export function tagNameList(task: TaskRecord): string[] {
  const tags = task.tags;
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => (typeof tag?.name === "string" ? tag.name : null))
    .filter((name): name is string => name !== null);
}

/** Every Asana GID is a long numeric string - anything else is a name. */
export function isGid(value: string): boolean {
  return /^\d{8,}$/.test(value.trim());
}
