/**
 * Google Maps adapter (POLICY.md R-8.10.1): the single module that imports the
 * `@vis.gl/react-google-maps` SDK. UI imports the primitives from here, so swapping
 * or upgrading the maps vendor touches only this file. Direct SDK imports elsewhere
 * are blocked by `no-restricted-imports` in eslint.config.mjs.
 */
export {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  InfoWindow,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
