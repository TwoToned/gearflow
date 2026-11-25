/**
 * Double bookings for ONE unit, from the bookings `availability.assetBookings` returns:
 * the number of bookings that overlap another booking of the same unit. A unit is a
 * quantity of one, so any two bookings whose rental windows overlap are a clash. Pure
 * and window-agnostic; the caller passes the bookings it read.
 */
export interface BookingWindow {
  id: string;
  rentalStartDate: string;
  rentalEndDate: string;
}

const ms = (iso: string) => new Date(iso).getTime();

export function countOverlappingBookings(bookings: readonly BookingWindow[]): number {
  const valid = bookings.filter((b) => Number.isFinite(ms(b.rentalStartDate)) && Number.isFinite(ms(b.rentalEndDate)));
  const clashing = new Set<string>();
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i];
      const b = valid[j];
      if (ms(a.rentalStartDate) <= ms(b.rentalEndDate) && ms(b.rentalStartDate) <= ms(a.rentalEndDate)) {
        clashing.add(a.id);
        clashing.add(b.id);
      }
    }
  }
  return clashing.size;
}
