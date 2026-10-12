export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Options = Omit<RequestInit, "body"> & { body?: unknown };

/**
 * Thin JSON client. Every route returns `{ error }` on failure, so unwrapping
 * that here keeps error handling in components down to a try/catch with a
 * message, instead of status-code branching at each call site.
 */
export async function api<T>(path: string, { body, ...init }: Options = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 204) return undefined as T;

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      (payload && typeof payload === "object" && "error" in payload && String(payload.error)) ||
      `Request failed (${res.status})`;
    const field =
      payload && typeof payload === "object" && "field" in payload
        ? String(payload.field)
        : undefined;
    throw new ApiError(res.status, message, field);
  }

  return payload as T;
}

export async function uploadFiles(
  workspaceId: string,
  files: File[],
): Promise<{ key: string; name: string; mimeType: string; size: number }[]> {
  const form = new FormData();
  form.set("workspaceId", workspaceId);
  for (const file of files) form.append("file", file);

  const res = await fetch("/api/upload", { method: "POST", body: form });
  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      (payload && typeof payload === "object" && "error" in payload && String(payload.error)) ||
      "Upload failed";
    throw new ApiError(res.status, message);
  }

  return payload.attachments;
}
