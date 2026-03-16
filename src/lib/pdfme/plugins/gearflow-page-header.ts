/**
 * gearflowPageHeader plugin — renders document header with logo/icon + org info + doc title.
 * Replicates the PdfHeader component from @react-pdf/renderer.
 * Three modes: "logo" (full logo + title row), "icon" (icon + name, title right), "none" (name + title right)
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
    // Row 1: Logo on left, doc title + meta on right
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

    if (logoImage) {
      const maxLogoW = 180;
      const maxLogoH = 60;
      const scale = Math.min(maxLogoW / logoImage.width, maxLogoH / logoImage.height, 1);
      const logoW = logoImage.width * scale;
      const logoH = logoImage.height * scale;

      page.drawImage(logoImage, {
        x,
        y: currentY - logoH,
        width: logoW,
        height: logoH,
      });
    }

    // Doc title on right
    const titleSize = 22;
    const titleWidth = fonts.bold.widthOfTextAtSize(config.docTitle, titleSize);
    page.drawText(config.docTitle, {
      x: x + width - titleWidth,
      y: currentY - titleSize,
      size: titleSize,
      font: fonts.bold,
      color: docColor,
    });

    // Doc meta below title
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

    currentY -= 70; // Advance past logo row

    // Company name below logo (if shown)
    if (showOrgName) {
      page.drawText(config.orgName, {
        x,
        y: currentY,
        size: 18,
        font: fonts.bold,
        color: docColor,
      });
      currentY -= 14;
    }

    // Org details below company name
    if (config.orgDetails) {
      const detailLines = config.orgDetails.split("\n");
      for (const line of detailLines) {
        page.drawText(line, {
          x,
          y: currentY,
          size: 8,
          font: fonts.regular,
          color: detailsColor,
        });
        currentY -= 12;
      }
    }

    return;
  }

  // === Icon/None mode ===
  // Left side: icon + org name + details
  let leftX = x;

  if (mode === "icon") {
    const iconSrc = config.iconData || config.logoData;
    if (iconSrc) {
      let iconImage;
      try {
        if (iconSrc.includes("image/png")) {
          iconImage = await pdfDoc.embedPng(iconSrc);
        } else {
          iconImage = await pdfDoc.embedJpg(iconSrc);
        }
      } catch {
        // Failed to embed icon
      }

      if (iconImage) {
        const iconSize = 40;
        page.drawImage(iconImage, {
          x: leftX,
          y: currentY - iconSize,
          width: iconSize,
          height: iconSize,
        });
        leftX += iconSize + 10; // gap
      }
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
  const titleSize = 22;
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
