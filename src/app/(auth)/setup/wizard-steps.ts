/** Total step count for the `/setup` wizard shell — shared by every step
 *  file (`page.tsx`'s step 1, `step-operating.tsx`'s step 2, and whichever
 *  files land for steps 3-4) so there is exactly one "5" (R-3.1), not one
 *  hardcoded per step. Its own file, not exported from `page.tsx`, to avoid
 *  a circular import between the shell page and its step components. */
export const TOTAL_STEPS = 5;
