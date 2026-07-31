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

  // Defensive defaults — prevent drawText(undefined) crashes
  const orgName = config.orgName || "";
  const docTitle = config.docTitle || "";
  const docMeta = config.docMeta || "";
  const orgDetails = config.orgDetails || "";

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
    // Layout: Logo at top-left; org name + details render below it. The doc
    // title + meta (right side) stay pinned to `topY` — the top of the
    // header, level with the logo itself — instead of following the text
    // block down, so "QUOTE" / doc number / date sit inline with the logo
    // rather than beneath it.
    const topY = currentY;
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

    // Shift down past logo, with breathing room before the company details
    // block underneath it.
    currentY -= logoH + 16;

    // Now render the same layout as icon/none mode below the logo
    // Left side: org name + details
    let textY = currentY;
    if (showOrgName && orgName) {
      page.drawText(orgName, {
        x,
        y: textY - 16,
        size: 18,
        font: fonts.bold,
        color: docColor,
      });
      textY -= 28;
    }

    if (orgDetails) {
      const detailLines = orgDetails.split("\n");
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

    // Right side: doc title + meta — inline with the logo (pinned to
    // `topY`), not the shifted org-details block below it.
    // Auto-scale title to fit within right half of header
    if (docTitle) {
      const maxTitleWidth = width * 0.55;
      let titleSize = 22;
      while (titleSize > 10 && fonts.bold.widthOfTextAtSize(docTitle, titleSize) > maxTitleWidth) {
        titleSize -= 1;
      }
      const titleWidth = fonts.bold.widthOfTextAtSize(docTitle, titleSize);
      page.drawText(docTitle, {
        x: x + width - titleWidth,
        y: topY - titleSize,
        size: titleSize,
        font: fonts.bold,
        color: docColor,
      });

      let metaY = topY - titleSize - 14;
      if (docMeta) {
        const metaLines = docMeta.split("\n");
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

      // Bold, document-coloured highlight line (e.g. invoice "Due: <date>")
      // — deliberately louder than the plain meta lines above it, right
      // where the client is already reading the doc number/date.
      if (config.highlightMeta) {
        const lineWidth = fonts.bold.widthOfTextAtSize(config.highlightMeta, 10);
        page.drawText(config.highlightMeta, {
          x: x + width - lineWidth,
          y: metaY - 1,
          size: 10,
          font: fonts.bold,
          color: docColor,
        });
      }
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
  if (showOrgName && orgName) {
    page.drawText(orgName, {
      x: leftX,
      y: textY - 16,
      size: 18,
      font: fonts.bold,
      color: docColor,
    });
    textY -= 28;
  }

  // Org details
  if (orgDetails) {
    const detailLines = orgDetails.split("\n");
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
  if (docTitle) {
    // Auto-scale title to fit within right half of header
    const maxTitleWidth = width * 0.55;
    let titleSize = 22;
    while (titleSize > 10 && fonts.bold.widthOfTextAtSize(docTitle, titleSize) > maxTitleWidth) {
      titleSize -= 1;
    }
    const titleWidth = fonts.bold.widthOfTextAtSize(docTitle, titleSize);
    page.drawText(docTitle, {
      x: x + width - titleWidth,
      y: currentY - titleSize,
      size: titleSize,
      font: fonts.bold,
      color: docColor,
    });

    let metaY = currentY - titleSize - 14;
    if (docMeta) {
      const metaLines = docMeta.split("\n");
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

    if (config.highlightMeta) {
      const lineWidth = fonts.bold.widthOfTextAtSize(config.highlightMeta, 10);
      page.drawText(config.highlightMeta, {
        x: x + width - lineWidth,
        y: metaY - 1,
        size: 10,
        font: fonts.bold,
        color: docColor,
      });
    }
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
