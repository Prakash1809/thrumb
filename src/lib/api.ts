import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const unauthorized = (m = "Unauthorized") => new HttpError(401, m);
export const forbidden = (m = "You do not have access to this") => new HttpError(403, m);
export const notFound = (m = "Not found") => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);
export const tooLarge = (m: string) => new HttpError(413, m);

/**
 * Wraps a route handler so thrown errors become JSON responses instead of
 * opaque 500s. Keeps every handler body free of try/catch.
 */
export function route<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof Response) return err;
      if (err instanceof HttpError) {
        return Response.json({ error: err.message }, { status: err.status });
      }
      if (err instanceof ZodError) {
        const issue = err.issues[0];
        return Response.json(
          { error: issue?.message ?? "Invalid request", field: issue?.path.join(".") },
          { status: 422 },
        );
      }
      console.error("[api]", err);
      return Response.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}

/** Parses a JSON body, turning malformed input into a 400 rather than a crash. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw badRequest("Expected a JSON body");
  }
}
