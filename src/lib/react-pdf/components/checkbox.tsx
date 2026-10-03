/**
 * Shared checkbox glyph — port of gearflow-table.ts's `drawCheckbox`. Used by
 * the packing-list "Ret"/ticked column, return-sheet's condition columns
 * (Good/Dmg/Missing), delivery-docket's "Received" column, and every
 * per-unit checkbox sub-row.
 *
 * react-pdf has no pdf-lib-style `drawRectangle`/`drawLine` primitives to
 * hand-place — `<Svg>` is the equivalent for a shape that isn't expressible
 * as a bordered `<View>` (a plain bordered View can't draw the diagonal
 * checkmark ticks). Coordinates below are the pdf-lib original's bottom-left,
 * y-up tick-mark geometry (0.2s,0.5s)→(0.4s,0.2s)→(0.85s,0.75s) flipped to
 * SVG's top-left, y-down space (y' = size - y) — same visual checkmark, one
 * coordinate system further down.
 */
import { Svg, Rect, Line } from "@react-pdf/renderer";

const BORDER_COLOR = "#333333";

export function Checkbox({ size = 7, checked = false }: { size?: number; checked?: boolean }) {
  const inset = 0.375; // half the 0.75pt border width, so the stroke sits inside `size`
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Rect
        x={inset}
        y={inset}
        width={size - inset * 2}
        height={size - inset * 2}
        stroke={BORDER_COLOR}
        strokeWidth={0.75}
        fill="none"
      />
      {checked && (
        <>
          <Line x1={size * 0.2} y1={size * 0.5} x2={size * 0.4} y2={size * 0.8} stroke={BORDER_COLOR} strokeWidth={1} />
          <Line x1={size * 0.4} y1={size * 0.8} x2={size * 0.85} y2={size * 0.25} stroke={BORDER_COLOR} strokeWidth={1} />
        </>
      )}
    </Svg>
  );
}
