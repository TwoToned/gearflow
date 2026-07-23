/**
 * In-memory fake for the Google Places SDK (POLICY.md R-8.10.4 — every vendor
 * adapter should have a local/fake implementation for tests). Stubs the
 * `google.maps.places` surface `AddressInput` (src/components/ui/address-input.tsx)
 * consumes — `AutocompleteSuggestion.fetchAutocompleteSuggestions` and the
 * `Place` class — so it can be smoke-tested without loading the real Maps JS SDK.
 * Pair with mocking `useMapsLibrary` from `@/lib/maps-sdk` to report "places" ready.
 */

export interface FakePlacePrediction {
  placeId: string;
  mainText: string;
  secondaryText?: string;
  fullText: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
}

export interface FakeMapsPlaces {
  /** Predictions returned by fetchAutocompleteSuggestions for the next query. */
  setPredictions: (predictions: FakePlacePrediction[]) => void;
  /** Install this fake as `google.maps.places` on the global object. Returns a restore fn. */
  install: () => () => void;
}

export function createFakeMapsPlaces(): FakeMapsPlaces {
  let predictions: FakePlacePrediction[] = [];
  const byId = new Map<string, FakePlacePrediction>();

  const places = {
    AutocompleteSuggestion: {
      fetchAutocompleteSuggestions: async () => ({
        suggestions: predictions.map((p) => ({
          placePrediction: {
            placeId: p.placeId,
            mainText: { text: p.mainText },
            secondaryText: p.secondaryText ? { text: p.secondaryText } : undefined,
            text: { text: p.fullText },
          },
        })),
      }),
    },
    Place: class {
      id: string;
      location: { lat: () => number; lng: () => number } | null = null;
      formattedAddress: string | undefined;
      constructor({ id }: { id: string }) {
        this.id = id;
      }
      async fetchFields() {
        const p = byId.get(this.id);
        if (!p) return;
        this.formattedAddress = p.formattedAddress;
        this.location = { lat: () => p.latitude, lng: () => p.longitude };
      }
    },
  };

  return {
    setPredictions: (next) => {
      predictions = next;
      byId.clear();
      for (const p of next) byId.set(p.placeId, p);
    },
    install: () => {
      const g = globalThis as unknown as { google?: unknown };
      const prevGoogle = g.google;
      g.google = { maps: { places } };
      return () => {
        g.google = prevGoogle;
      };
    },
  };
}
