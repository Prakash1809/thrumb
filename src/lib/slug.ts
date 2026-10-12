const ALPHANUM = /[a-z0-9]/;

/** Lowercase, hyphen-joined slug. Falls back to "workspace" if nothing survives. */
export function slugify(input: string): string {
  const lower = input.toLowerCase();
  let out = "";
  let pendingDash = false;

  for (const char of lower) {
    if (ALPHANUM.test(char)) {
      if (pendingDash && out) out += "-";
      pendingDash = false;
      out += char;
    } else {
      pendingDash = true;
    }
  }

  return out.slice(0, 48) || "workspace";
}

/**
 * Appends a counter until `isTaken` says the slug is free. Used for workspace
 * slugs, where two people naming a workspace the same thing is routine.
 */
export async function uniqueSlug(base: string, isTaken: (slug: string) => Promise<boolean>) {
  const root = slugify(base);
  if (!(await isTaken(root))) return root;
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${root}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}
