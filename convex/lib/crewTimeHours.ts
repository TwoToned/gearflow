/**
 * Convex-native port of src/server/crew-time.ts#calculateTotalHours. Pure: worked
 * minutes = (end − start − break), rounded to 2dp hours, floored at 0.
 */
export function calculateTotalHours(startTime: string, endTime: string, breakMinutes: number): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const worked = (eh * 60 + em) - (sh * 60 + sm) - breakMinutes;
  return Math.max(0, Math.round((worked * 100) / 60) / 100);
}
