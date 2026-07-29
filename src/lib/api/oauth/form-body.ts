/** Parse an `application/x-www-form-urlencoded` (or multipart) request body
 *  into a flat `URLSearchParams` — shared by every OAuth endpoint that takes a
 *  form body (token, revoke), per RFC 6749 §4.1.3. Returns `null` on any
 *  parse failure so callers can return a uniform `invalid_request`. */
export async function parseFormBody(request: Request): Promise<URLSearchParams | null> {
  try {
    const body = await request.formData();
    const form = new URLSearchParams();
    for (const [key, value] of body.entries()) {
      if (typeof value === "string") form.set(key, value);
    }
    return form;
  } catch {
    return null;
  }
}
