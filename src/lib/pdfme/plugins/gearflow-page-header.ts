/**
 * gearflowPageHeader plugin — renders document header with logo/icon + org info + doc title.
 * Three modes: "logo" (full logo above, compact details below), "icon" (icon + name, title right), "none" (name + title right)
 */
import type { Plugin, Schema, PDFRenderProps } from "@pdfme/common";
import { getLayoutProps, hexToRgb, getHelveticaFonts, stubUiRender, stubPropPanel } from "./helpers";
import type { PageHeaderConfig } from "../types";

interface PageHeaderSchema extends Schema {
  type: "gearflowPageHeader";
}

async function pdfRender(arg: PDFRenderProps<PageHeaderSchema>) {
  const { schema, page, pdfLib, pdfDoc, _cache } = arg;
  const value = arg.value || "{}";
  const config = JSON.parse(value) as PageHeaderConfig;

  const pageHeight = page.getHeight();
  const { x, y, width, height } = getLayoutProps(schema, pageHeight);
  const fonts = await getHelveticaFonts(pdfDoc, pdfLib, _cache);

  const docColor = hexToRgb(config.documentColor || "#0d4f4f", pdfLib);
  const metaColor = hexToRgb("#666666", pdfLib);
  const detailsColor = hexToRgb("#666666", pdfLib);

  const mode = config.documentLogoMode || "icon";
  const showOrgName = config.showOrgNameOnDocuments !== false;

  let currentY = y + height; // Start from top of the allocated area

  // === Logo mode ===
  if (mode === "logo" && config.logoData) {
    // Layout: Logo at top-left, then same org name + details layout as icon/none
    // below, shifted down so nothing overlaps the logo.
    let logoImage;
    try {
      if (config.logoData.includes("image/png")) {
        logoImage = await pdfDoc.embedPng(config.logoData);
      } else {
        logoImage = await pdfDoc.embedJpg(config.logoData);
      }
    } catch {
      // Failed to embed logo, skip
    }

    let logoH = 0;
    if (logoImage) {
      const maxLogoW = 200;
      const maxLogoH = 50;
      const scale = Math.min(maxLogoW / logoImage.width, maxLogoH / logoImage.height, 1);
      const logoW = logoImage.width * scale;
      logoH = logoImage.height * scale;

      page.drawImage(logoImage, {
        x,
        y: currentY - logoH,
        width: logoW,
        height: logoH,
      });
    }

    // Shift down past logo
    currentY -= logoH + 8;

    // Now render the same layout as icon/none mode below the logo
    // Left side: org name + details
    let textY = currentY;
    if (showOrgName) {
      page.drawText(config.orgName, {
        x,
        y: textY - 16,
        size: 18,
        font: fonts.bold,
        color: docColor,
      });
      textY -= 28;
    }

    if (config.orgDetails) {
      const detailLines = config.orgDetails.split("\n");
      for (const line of detailLines) {
        page.drawText(line, {
          x,
          y: textY,
          size: 8,
          font: fonts.regular,
          color: detailsColor,
        });
        textY -= 12;
      }
    }

    // Right side: doc title + meta (aligned to the same row as org name)
    // Auto-scale title to fit within right half of header
    const maxTitleWidth = width * 0.55;
    let titleSize = 22;
    while (titleSize > 10 && fonts.bold.widthOfTextAtSize(config.docTitle, titleSize) > maxTitleWidth) {
      titleSize -= 1;
    }
    const titleWidth = fonts.bold.widthOfTextAtSize(config.docTitle, titleSize);
    page.drawText(config.docTitle, {
      x: x + width - titleWidth,
      y: currentY - titleSize,
      size: titleSize,
      font: fonts.bold,
      color: docColor,
    });

    const metaLines = config.docMeta.split("\n");
    let metaY = currentY - titleSize - 14;
    for (const line of metaLines) {
      const lineWidth = fonts.regular.widthOfTextAtSize(line, 9);
      page.drawText(line, {
        x: x + width - lineWidth,
        y: metaY,
        size: 9,
        font: fonts.regular,
        color: metaColor,
      });
      metaY -= 13;
    }

    return;
  }

  // === Icon/None mode ===
  // Left side: icon + org name + details
  let leftX = x;

  if (mode === "icon" && config.iconData) {
    // Only use dedicated icon data — don't fall back to logo (a wide logo
    // looks wrong squished into a 40×40 square)
    let iconImage;
    try {
      if (config.iconData.includes("image/png")) {
        iconImage = await pdfDoc.embedPng(config.iconData);
      } else {
        iconImage = await pdfDoc.embedJpg(config.iconData);
      }
    } catch {
      // Failed to embed icon
    }

    if (iconImage) {
      const maxH = 40;
      const scale = Math.min(maxH / iconImage.height, 1);
      const iconW = iconImage.width * scale;
      const iconH = iconImage.height * scale;
      page.drawImage(iconImage, {
        x: leftX,
        y: currentY - iconH,
        width: iconW,
        height: iconH,
      });
      leftX += iconW + 10; // gap
    }
  }

  // Company name
  let textY = currentY;
  if (showOrgName) {
    page.drawText(config.orgName, {
      x: leftX,
      y: textY - 16,
      size: 18,
      font: fonts.bold,
      color: docColor,
    });
    textY -= 28;
  }

  // Org details
  if (config.orgDetails) {
    const detailLines = config.orgDetails.split("\n");
    for (const line of detailLines) {
      page.drawText(line, {
        x: leftX,
        y: textY,
        size: 8,
        font: fonts.regular,
        color: detailsColor,
      });
      textY -= 12;
    }
  }

  // Right side: doc title + meta
  // Auto-scale title to fit within right half of header
  const maxTitleWidth = width * 0.55;
  let titleSize = 22;
  while (titleSize > 10 && fonts.bold.widthOfTextAtSize(config.docTitle, titleSize) > maxTitleWidth) {
    titleSize -= 1;
  }
  const titleWidth = fonts.bold.widthOfTextAtSize(config.docTitle, titleSize);
  page.drawText(config.docTitle, {
    x: x + width - titleWidth,
    y: currentY - titleSize,
    size: titleSize,
    font: fonts.bold,
    color: docColor,
  });

  const metaLines = config.docMeta.split("\n");
  let metaY = currentY - titleSize - 14;
  for (const line of metaLines) {
    const lineWidth = fonts.regular.widthOfTextAtSize(line, 9);
    page.drawText(line, {
      x: x + width - lineWidth,
      y: metaY,
      size: 9,
      font: fonts.regular,
      color: metaColor,
    });
    metaY -= 13;
  }
}

const gearflowPageHeader: Plugin<PageHeaderSchema> = {
  pdf: pdfRender,
  ui: stubUiRender(),
  propPanel: stubPropPanel({
    name: "",
    type: "gearflowPageHeader",
    position: { x: 0, y: 0 },
    width: 170,
    height: 25,
  }),
};

export default gearflowPageHeader;
