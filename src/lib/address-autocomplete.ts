export interface PlaceResult {
  address: string;
  latitude: number;
  longitude: number;
  placeId?: string;
}

export const DEBOUNCE_MS = 300;
export const MIN_QUERY_LENGTH = 3;
