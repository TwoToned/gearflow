/**
 * The Manage templates dialog and the New template sheet are URL state on any `/projects/*`
 * page (`?templates=1`, `?templates=new`), so a link, a reload and the back button agree and the
 * wizard can open them without leaving its page.
 */
export const TEMPLATES_PARAM = "templates";

function withParam(pathname: string, search: string | URLSearchParams, value: string | null): string {
  const params = new URLSearchParams(typeof search === "string" ? search : search.toString());
  if (value === null) params.delete(TEMPLATES_PARAM);
  else params.set(TEMPLATES_PARAM, value);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export const templatesHref = (pathname: string, search: string | URLSearchParams = "", mode: "1" | "new" = "1") => withParam(pathname, search, mode);
export const templatesCloseHref = (pathname: string, search: string | URLSearchParams = "") => withParam(pathname, search, null);
