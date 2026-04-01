/**
 * Call Sheet Info plugin — dense 2-column info block for call sheets.
 * Left column: PM, Client, Equipment summary.
 * Right column: Venue, Schedule times.
 */
import type { Plugin, Schema } from "@pdfme/common";
import { getLayoutProps, hexToRgb, getHelveticaFonts, truncateText, stubUiRender, stubPropPanel } from "./helpers";

export interface CallSheetInfoConfig {
  pmName: string;
  pmPhone: string;
  pmEmail: string;
  clientName: string;
  clientContact: string;
  venueName: string;
  venueAddress: string;
  loadInDate: string;
  loadOutDate: string;
  eventStart: string;
  eventEnd: string;
  equipmentSummary: string;
  documentColor: string;
  showPmContact: boolean;
  showClientContact: boolean;
  showVenueDetails: boolean;
  showScheduleTimes: boolean;
  showEquipmentSummary: boolean;
}

const defaultSchema: Schema = {
  name: "callSheetInfo",
  type: "gearflowCallSheetInfo",
  content: "",
  position: { x: 0, y: 0 },
  width: 269,
  height: 35,
};

const gearflowCallSheetInfo: Plugin<Schema> = {
  ui: stubUiRender(),
  pdf: async (arg) => {
    const pdfLib = await import("@pdfme/pdf-lib");
    const { page, schema, value, options } = arg as unknown as {
      page: import("@pdfme/pdf-lib").PDFPage;
      schema: Schema;
      value: string;
      options: { font?: unknown; _cache: Map<string | number, unknown> };
    };

    if (!value) return;

    let config: CallSheetInfoConfig;
    try {
      config = JSON.parse(value);
    } catch {
      return;
    }

    const { height: pageHeight } = page.getSize();
    const { x, y, width, height } = getLayoutProps(schema, pageHeight);
    const fonts = await getHelveticaFonts(
      page.doc,
      pdfLib,
      options._cache
    );

    const labelSize = 7;
    const valueSize = 9;
    const lineHeight = 12;
    const accentColor = hexToRgb(config.documentColor || "#0d4f4f", pdfLib);
    const labelColor = hexToRgb("#666666", pdfLib);
    const valueColor = hexToRgb("#1a1a1a", pdfLib);
    const dividerColor = hexToRgb("#dddddd", pdfLib);

    // Draw top border
    page.drawLine({
      start: { x, y: y + height },
      end: { x: x + width, y: y + height },
      thickness: 0.5,
      color: dividerColor,
    });

    // Column widths (55% left, 45% right)
    const leftW = width * 0.55;
    const rightX = x + leftW + 8;
    const rightW = width - leftW - 8;

    // Draw vertical divider
    const dividerX = x + leftW + 4;
    page.drawLine({
      start: { x: dividerX, y: y + height - 4 },
      end: { x: dividerX, y: y + 4 },
      thickness: 0.5,
      color: dividerColor,
    });

    // Helper to draw a label/value pair
    let leftY = y + height - 10;
    let rightY = y + height - 10;

    function drawField(
      col: "left" | "right",
      label: string,
      value: string,
    ) {
      const colX = col === "left" ? x : rightX;
      const colW = col === "left" ? leftW : rightW;
      const curY = col === "left" ? leftY : rightY;

      // Label
      page.drawText(label, {
        x: colX,
        y: curY,
        size: labelSize,
        font: fonts.bold,
        color: labelColor,
      });

      // Value
      const truncated = truncateText(value || "\u2014", fonts.regular, valueSize, colW);
      page.drawText(truncated, {
        x: colX,
        y: curY - 10,
        size: valueSize,
        font: fonts.regular,
        color: valueColor,
      });

      if (col === "left") {
        leftY -= lineHeight * 2;
      } else {
        rightY -= lineHeight * 2;
      }
    }

    // Left column
    if (config.showPmContact) {
      const pmValue = config.pmName
        ? `${config.pmName}${config.pmPhone ? ` | ${config.pmPhone}` : ""}${config.pmEmail ? ` | ${config.pmEmail}` : ""}`
        : "\u2014";
      drawField("left", "PROJECT MANAGER", pmValue);
    }

    if (config.showClientContact) {
      const clientValue = config.clientName
        ? `${config.clientName}${config.clientContact ? ` (${config.clientContact})` : ""}`
        : "\u2014";
      drawField("left", "CLIENT", clientValue);
    }

    if (config.showEquipmentSummary) {
      drawField("left", "EQUIPMENT", config.equipmentSummary || "No equipment assigned");
    }

    // Right column
    if (config.showVenueDetails) {
      const venueValue = config.venueName
        ? `${config.venueName}${config.venueAddress ? ` - ${config.venueAddress}` : ""}`
        : "\u2014";
      drawField("right", "VENUE", venueValue);
    }

    if (config.showScheduleTimes) {
      const schedValue = [
        config.loadInDate !== "-" ? `Load In: ${config.loadInDate}` : null,
        config.loadOutDate !== "-" ? `Load Out: ${config.loadOutDate}` : null,
      ].filter(Boolean).join("  |  ") || "\u2014";
      drawField("right", "SCHEDULE", schedValue);

      const eventValue = [
        config.eventStart !== "-" ? `Start: ${config.eventStart}` : null,
        config.eventEnd !== "-" ? `End: ${config.eventEnd}` : null,
      ].filter(Boolean).join("  |  ") || "\u2014";
      drawField("right", "EVENT", eventValue);
    }

    // Bottom border
    page.drawLine({
      start: { x, y },
      end: { x: x + width, y },
      thickness: 0.5,
      color: dividerColor,
    });
  },
  propPanel: stubPropPanel(defaultSchema),
};

export default gearflowCallSheetInfo;
