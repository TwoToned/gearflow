/**
 * A QR code drawn as vector paths (react-pdf `<Svg>`), so a label can print one
 * synchronously — no async data-URL step in the render pipeline, and it stays
 * crisp at any print size. Encodes the plain string it is given (an asset tag,
 * the same payload the on-screen asset QR uses).
 */
import { Svg, Path } from "@react-pdf/renderer";
import QRCode from "qrcode";

/** Modules of white around the code; scanners need a quiet zone to lock on. */
const QUIET_ZONE = 2;

/** One path covering every dark module, so the PDF carries a single shape. */
export function qrPathData(value: string): { d: string; size: number } {
  const { modules } = QRCode.create(value, { errorCorrectionLevel: "M" });
  const size = modules.size;
  let d = "";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (modules.get(row, col)) d += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
    }
  }
  return { d, size: size + QUIET_ZONE * 2 };
}

export function QrCode({ value, sizeMm }: { value: string; sizeMm: number }) {
  const { d, size } = qrPathData(value);
  return (
    <Svg viewBox={`0 0 ${size} ${size}`} style={{ width: `${sizeMm}mm`, height: `${sizeMm}mm`, backgroundColor: "#ffffff" }}>
      <Path d={d} fill="#000000" />
    </Svg>
  );
}
