import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@/lib/init";
import { getAppContext } from "@directoryone/app";
import { getDirectoryConfig } from "@directoryone/core/actions";
import {
  generateBrandPalette,
  generateStatusPalette,
  CARD_RADIUS_PRESETS,
  CARD_SHADOW_PRESETS,
  BUTTON_RADIUS_PRESETS,
} from "@directoryone/core/utils";
import { generateRootMetadata, RootBody } from "@directoryone/app/routes/root-layout";
import { GoogleAnalytics } from "@directoryone/ui/common";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return generateRootMetadata();
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { db } = getAppContext();
  const config = await getDirectoryConfig(db);
  const branding = config?.branding;
  const htmlStyle: Record<string, string> = {};

  // Primary brand palette
  if (branding?.primaryColor) {
    const palette = generateBrandPalette(branding.primaryColor);
    for (const [shade, hex] of Object.entries(palette)) {
      htmlStyle[`--color-brand-${shade}`] = hex;
    }
  }

  // Secondary / accent palette
  if (branding?.secondaryColor) {
    const palette = generateBrandPalette(branding.secondaryColor);
    for (const [shade, hex] of Object.entries(palette)) {
      htmlStyle[`--color-accent-${shade}`] = hex;
    }
  }

  // Background, surface & border colors
  if (branding?.backgroundColor) htmlStyle["--color-background"] = branding.backgroundColor;
  if (branding?.surfaceColor) htmlStyle["--color-surface"] = branding.surfaceColor;
  if (branding?.surfaceMutedColor) htmlStyle["--color-surface-muted"] = branding.surfaceMutedColor;
  if (branding?.cardBgColor) htmlStyle["--color-card-bg"] = branding.cardBgColor;
  if (branding?.cardTextColor) htmlStyle["--color-card-text"] = branding.cardTextColor;
  if (branding?.borderColor) htmlStyle["--color-border"] = branding.borderColor;

  // Header & footer colors
  if (branding?.headerBgColor) htmlStyle["--color-header-bg"] = branding.headerBgColor;
  if (branding?.headerTextColor) htmlStyle["--color-header-text"] = branding.headerTextColor;
  if (branding?.footerBgColor) htmlStyle["--color-footer-bg"] = branding.footerBgColor;
  if (branding?.footerTextColor) htmlStyle["--color-footer-text"] = branding.footerTextColor;

  // Card radius & shadow presets
  if (branding?.cardRadius && CARD_RADIUS_PRESETS[branding.cardRadius]) {
    htmlStyle["--radius-card"] = CARD_RADIUS_PRESETS[branding.cardRadius].value;
  }
  if (branding?.cardShadow && CARD_SHADOW_PRESETS[branding.cardShadow]) {
    htmlStyle["--shadow-card"] = CARD_SHADOW_PRESETS[branding.cardShadow].value;
    htmlStyle["--shadow-card-hover"] = CARD_SHADOW_PRESETS[branding.cardShadow].hover;
  }

  // Button radius preset
  if (branding?.buttonRadius && BUTTON_RADIUS_PRESETS[branding.buttonRadius]) {
    htmlStyle["--radius-btn"] = BUTTON_RADIUS_PRESETS[branding.buttonRadius].value;
  }

  // Text colors
  if (branding?.foregroundColor) htmlStyle["--color-foreground"] = branding.foregroundColor;
  if (branding?.bodyTextColor) htmlStyle["--color-body-text"] = branding.bodyTextColor;
  if (branding?.mutedTextColor) htmlStyle["--color-muted-text"] = branding.mutedTextColor;

  // Status colors
  if (branding?.successColor) {
    const p = generateStatusPalette(branding.successColor);
    htmlStyle["--color-success-bg"] = p.bg;
    htmlStyle["--color-success-border"] = p.border;
    htmlStyle["--color-success-text"] = p.text;
  }
  if (branding?.warningColor) {
    const p = generateStatusPalette(branding.warningColor);
    htmlStyle["--color-warning-bg"] = p.bg;
    htmlStyle["--color-warning-border"] = p.border;
    htmlStyle["--color-warning-text"] = p.text;
  }
  if (branding?.errorColor) {
    const p = generateStatusPalette(branding.errorColor);
    htmlStyle["--color-error-bg"] = p.bg;
    htmlStyle["--color-error-border"] = p.border;
    htmlStyle["--color-error-text"] = p.text;
  }
  if (branding?.infoColor) {
    const p = generateStatusPalette(branding.infoColor);
    htmlStyle["--color-info-bg"] = p.bg;
    htmlStyle["--color-info-border"] = p.border;
    htmlStyle["--color-info-text"] = p.text;
  }

  // Rating color
  if (branding?.ratingColor) htmlStyle["--color-rating"] = branding.ratingColor;

  // Font family override
  if (branding?.fontFamily) {
    const fontName = branding.fontFamily.replace(/\+/g, " ");
    htmlStyle["--font-sans"] = `"${fontName}", ui-sans-serif, system-ui, sans-serif`;
  }

  // Google Fonts link tag
  const googleFontLink = branding?.fontFamily
    ? `https://fonts.googleapis.com/css2?family=${branding.fontFamily}:wght@300;400;500;600;700&display=swap`
    : null;

  return (
    <html lang={config?.locale || "en-US"} className={inter.variable} style={htmlStyle}>
      <head>
        {googleFontLink && (
          <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
            <link rel="stylesheet" href={googleFontLink} />
          </>
        )}
      </head>
      {config?.googleAnalyticsId && (
        <GoogleAnalytics id={config.googleAnalyticsId} />
      )}
      <RootBody>{children}</RootBody>
    </html>
  );
}
