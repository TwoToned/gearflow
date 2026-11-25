/**
 * The job edit sheet is a URL state (`?edit=1` on the record, D22), so a link,
 * a reload and the back button all agree. Every entry point (header `Edit`,
 * Overview `Edit dates`, Where `Edit`, a readiness fix) builds its href here.
 */
export const JOB_EDIT_PARAM = "edit";

/** The record's URL with the sheet open, keeping every other param (`?tab=`). */
export function jobEditHref(pathname: string, search: string | URLSearchParams = ""): string {
  const params = new URLSearchParams(typeof search === "string" ? search : search.toString());
  params.set(JOB_EDIT_PARAM, "1");
  return `${pathname}?${params.toString()}`;
}

/** The same URL with the sheet closed. */
export function jobEditCloseHref(pathname: string, search: string | URLSearchParams = ""): string {
  const params = new URLSearchParams(typeof search === "string" ? search : search.toString());
  params.delete(JOB_EDIT_PARAM);
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
