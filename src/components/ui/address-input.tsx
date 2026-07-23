"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { z } from "zod";
import { MapPin } from "lucide-react";
import { useMapsLibrary } from "@/lib/maps-sdk";
import { cn } from "@/lib/utils";
import { capture, AnalyticsEvent } from "@/lib/analytics";
import {
  DEBOUNCE_MS,
  MIN_QUERY_LENGTH,
  type PlaceResult,
} from "@/lib/address-autocomplete";

// Runtime shape of the Google Places result we consume (R-8.10.3).
const placeResultSchema = z.object({
  address: z.string().min(1),
  latitude: z.number().finite(),
  longitude: z.number().finite(),
  placeId: z.string().min(1),
});

interface Prediction {
  placeId: string;
  mainText: string;
  secondaryText: string;
  fullText: string;
}

interface AddressInputProps {
  value: string;
  onChange: (value: string) => void;
  onPlaceSelect?: (place: PlaceResult | null) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  className?: string;
  initialCoordinates?: { latitude: number; longitude: number } | null;
  /** ISO 3166-1 alpha-2 country code to bias results (e.g. "AU", "US") */
  countryCode?: string;
}

export function AddressInput({
  value,
  onChange,
  onPlaceSelect,
  placeholder = "Start typing an address...",
  disabled,
  className,
  initialCoordinates,
  countryCode,
}: AddressInputProps) {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isGeocoded, setIsGeocoded] = useState(!!initialCoordinates);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const places = useMapsLibrary("places");
  const placesReady = !!places;

  // Sync geocoded state when initialCoordinates changes
  useEffect(() => {
    setIsGeocoded(!!initialCoordinates); // eslint-disable-line react-hooks/set-state-in-effect
  }, [initialCoordinates]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const fetchPredictions = useCallback(async (query: string) => {
    if (query.length < MIN_QUERY_LENGTH || !placesReady) {
      setPredictions([]);
      setIsOpen(false);
      return;
    }

    try {
      const request: google.maps.places.AutocompleteRequest = {
        input: query,
        includedRegionCodes: countryCode ? [countryCode.toLowerCase()] : undefined,
      };

      const { suggestions } =
        await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
      // T-P4 cost tracking (R-9.12/#764) — one billable Autocomplete request.
      capture(AnalyticsEvent.VendorUsage, { vendor: "maps", operation: "autocomplete" });

      const mapped: Prediction[] = suggestions
        .map((s) => {
          const p = s.placePrediction;
          if (!p) return null;
          return {
            placeId: p.placeId,
            mainText: p.mainText?.text || "",
            secondaryText: p.secondaryText?.text || "",
            fullText: p.text?.text || "",
          };
        })
        .filter((x): x is Prediction => x !== null);

      setPredictions(mapped);
      setIsOpen(mapped.length > 0);
      setActiveIndex(-1);
    } catch {
      setPredictions([]);
      setIsOpen(false);
    }
  }, [countryCode, placesReady]);

  async function selectPlace(prediction: Prediction) {
    try {
      const place = new google.maps.places.Place({
        id: prediction.placeId,
      });

      await place.fetchFields({
        fields: ["location", "formattedAddress"],
      });
      // T-P4 cost tracking (R-9.12/#764) — one billable Place Details request.
      capture(AnalyticsEvent.VendorUsage, { vendor: "maps", operation: "place_details" });

      const loc = place.location;
      if (loc) {
        // Validate the Google Places response before it flows into the app
        // (POLICY.md R-8.10.3 — vendor responses are untrusted input).
        const parsed = placeResultSchema.safeParse({
          address: place.formattedAddress || prediction.fullText,
          latitude: loc.lat(),
          longitude: loc.lng(),
          placeId: prediction.placeId,
        });
        if (parsed.success) {
          onChange(parsed.data.address);
          setIsGeocoded(true);
          setPredictions([]);
          setIsOpen(false);
          setActiveIndex(-1);
          onPlaceSelect?.(parsed.data);
          return;
        }
      }
      // No valid location → fall through to the text-only fallback below.
      throw new Error("no valid place location");
    } catch {
      // Fallback: use the prediction text without coordinates
      onChange(prediction.fullText);
      setPredictions([]);
      setIsOpen(false);
      setActiveIndex(-1);
    }
  }

  function handleInputChange(text: string) {
    onChange(text);

    // If user modifies text after a selection, clear coordinates
    if (isGeocoded) {
      setIsGeocoded(false);
      onPlaceSelect?.(null);
    }

    // Debounced autocomplete
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPredictions(text), DEBOUNCE_MS);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen || predictions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i < predictions.length - 1 ? i + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i > 0 ? i - 1 : predictions.length - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      selectPlace(predictions[activeIndex]);
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => {
            if (predictions.length > 0) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-fg-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            isGeocoded && "pr-8",
            className
          )}
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          autoComplete="off"
        />
        {isGeocoded && (
          <MapPin className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-teal-500" />
        )}
      </div>

      {isOpen && predictions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          <ul role="listbox" className="max-h-60 overflow-auto py-1">
            {predictions.map((prediction, i) => (
              <li
                key={prediction.placeId}
                role="option"
                aria-selected={i === activeIndex}
                className={cn(
                  "cursor-pointer px-3 py-2 text-sm",
                  i === activeIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50"
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectPlace(prediction);
                }}
              >
                <div className="font-medium">{prediction.mainText}</div>
                {prediction.secondaryText && (
                  <div className="text-xs text-fg-3 truncate">
                    {prediction.secondaryText}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="border-t px-3 py-1.5 text-[10px] text-fg-3">
            Powered by Google
          </div>
        </div>
      )}
    </div>
  );
}
