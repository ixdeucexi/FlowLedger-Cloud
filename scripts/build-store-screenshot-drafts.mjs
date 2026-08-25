#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const storeAssetRoot = path.join(repositoryRoot, "store-assets", "v1");
const draftRoot = path.join(storeAssetRoot, "screenshots", "draft-pwa");
const copyFilePath = path.join(draftRoot, "copy.json");
const generatedManifestPath = path.join(draftRoot, "manifest.json");

const PLATFORM_CONFIGS = {
  "android-phone": {
    label: "Google Play phone",
    rawWidth: 450,
    rawHeight: 900,
    outputWidth: 1350,
    outputHeight: 2700,
  },
  "ios-6.9": {
    label: "Apple 6.9-inch portrait",
    rawWidth: 430,
    rawHeight: 932,
    outputWidth: 1290,
    outputHeight: 2796,
  },
};

const CONTACT_SHEET = {
  width: 2400,
  height: 1840,
  columns: 4,
  rows: 2,
  margin: 60,
  columnGap: 30,
  rowGap: 30,
  headerHeight: 170,
};

function parseArguments(argv) {
  const platformIndex = argv.indexOf("--platform");
  const requestedPlatform = platformIndex >= 0 ? argv[platformIndex + 1] : "all";

  if (platformIndex >= 0 && !requestedPlatform) {
    throw new Error("--platform requires android-phone, ios-6.9, or all.");
  }

  if (requestedPlatform === "all") {
    return Object.keys(PLATFORM_CONFIGS);
  }

  if (!Object.hasOwn(PLATFORM_CONFIGS, requestedPlatform)) {
    throw new Error(
      `Unknown platform "${requestedPlatform}". Use android-phone, ios-6.9, or all.`,
    );
  }

  return [requestedPlatform];
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapText(value, maximumCharacters) {
  const words = String(value).trim().split(/\s+/u);
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (candidate.length <= maximumCharacters || !currentLine) {
      currentLine = candidate;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines;
}

function relativeAssetPath(absolutePath) {
  return path.relative(storeAssetRoot, absolutePath).split(path.sep).join("/");
}

async function sha256(filePath) {
  const contents = await readFile(filePath);
  return createHash("sha256").update(contents).digest("hex").toUpperCase();
}

async function inspectImage(filePath) {
  const metadata = await sharp(filePath).metadata();
  return {
    file: relativeAssetPath(filePath),
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    channels: metadata.channels,
    hasAlpha: metadata.hasAlpha === true,
    colorSpace: metadata.space,
    sha256: await sha256(filePath),
  };
}

async function normalizeRawCapture(filePath) {
  const original = await inspectImage(filePath);
  if (original.format === "png") {
    return { record: original, normalizedFrom: null };
  }
  if (original.format !== "jpeg") {
    throw new Error(
      `${relativeAssetPath(filePath)} must contain PNG or browser-captured JPEG data; received ${original.format ?? "unknown format"}.`,
    );
  }

  const normalizedPath = `${filePath}.normalized.png`;
  await sharp(filePath, { limitInputPixels: false })
    .flatten({ background: "#050817" })
    .toColourspace("srgb")
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
    .toFile(normalizedPath);
  await rename(normalizedPath, filePath);

  return { record: await inspectImage(filePath), normalizedFrom: "jpeg" };
}

function requireDimensions(record, width, height, label) {
  if (record.format !== "png") {
    throw new Error(`${label} must be PNG; received ${record.format ?? "unknown format"}.`);
  }
  if (record.width !== width || record.height !== height) {
    throw new Error(
      `${label} must be ${width}x${height}; received ${record.width ?? "?"}x${record.height ?? "?"}.`,
    );
  }
}

function requireStoreColor(record, label) {
  if (record.channels !== 3 || record.hasAlpha) {
    throw new Error(
      `${label} must be 24-bit RGB with no alpha; received ${record.channels ?? "?"} channels` +
        `${record.hasAlpha ? " with alpha" : ""}.`,
    );
  }
}

async function readScreenshotCopy() {
  const parsed = JSON.parse(await readFile(copyFilePath, "utf8"));
  if (!Array.isArray(parsed.sequence) || parsed.sequence.length < 2 || parsed.sequence.length > 10) {
    throw new Error("copy.json must define between 2 and 10 screenshot slots.");
  }

  const fileNames = new Set();
  for (const [index, screenshot] of parsed.sequence.entries()) {
    if (
      screenshot.slot !== index + 1 ||
      typeof screenshot.file !== "string" ||
      typeof screenshot.screen !== "string" ||
      typeof screenshot.headline !== "string" ||
      typeof screenshot.caption !== "string"
    ) {
      throw new Error(`copy.json screenshot slot ${index + 1} is incomplete or out of order.`);
    }
    if (!/^\d{2}-[a-z0-9-]+\.png$/u.test(screenshot.file)) {
      throw new Error(`Invalid raw screenshot filename: ${screenshot.file}`);
    }
    if (fileNames.has(screenshot.file)) {
      throw new Error(`Duplicate screenshot filename: ${screenshot.file}`);
    }
    fileNames.add(screenshot.file);
  }

  return parsed;
}

async function validateRawDirectory(rawDirectory, screenshotCopy, platform) {
  const expectedFiles = new Set(screenshotCopy.sequence.map((screenshot) => screenshot.file));
  let entries;
  try {
    entries = await readdir(rawDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Missing ${platform} raw screenshot directory: ${relativeAssetPath(rawDirectory)}`);
    }
    throw error;
  }

  const availablePngFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
    .map((entry) => entry.name)
    .sort();
  const missingFiles = [...expectedFiles].filter((fileName) => !availablePngFiles.includes(fileName));
  const unexpectedFiles = availablePngFiles.filter((fileName) => !expectedFiles.has(fileName));

  if (missingFiles.length || unexpectedFiles.length) {
    const details = [
      missingFiles.length ? `missing: ${missingFiles.join(", ")}` : "",
      unexpectedFiles.length ? `unexpected: ${unexpectedFiles.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    throw new Error(`${platform} raw screenshot set is not exact (${details}).`);
  }
}

function requireUniqueScreenshotContent(files, platform) {
  for (const kind of ["raw", "store"]) {
    const seen = new Map();
    for (const file of files) {
      const hash = file[kind].sha256;
      const prior = seen.get(hash);
      if (prior) {
        throw new Error(
          `${platform} ${kind} screenshots ${prior} and ${file.slot} have identical content; recapture the mislabeled slot.`,
        );
      }
      seen.set(hash, file.slot);
    }
  }
}

function createContactSheetSvg(platformConfig, screenshotCopy, cardWidth, cardHeight) {
  const { width, height, columns, margin, columnGap, rowGap, headerHeight } = CONTACT_SHEET;
  const cards = screenshotCopy.sequence
    .map((screenshot, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = margin + column * (cardWidth + columnGap);
      const y = headerHeight + margin + row * (cardHeight + rowGap);
      const headlineLines = wrapText(screenshot.headline, 31).slice(0, 2);
      const captionLines = wrapText(screenshot.caption, 45).slice(0, 2);
      const headline = headlineLines
        .map(
          (line, lineIndex) =>
            `<text x="${x + 26}" y="${y + 45 + lineIndex * 34}" class="headline">${xmlEscape(line)}</text>`,
        )
        .join("");
      const captionStart = y + 48 + headlineLines.length * 34;
      const caption = captionLines
        .map(
          (line, lineIndex) =>
            `<text x="${x + 26}" y="${captionStart + lineIndex * 26}" class="caption">${xmlEscape(line)}</text>`,
        )
        .join("");

      return `
        <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="28" fill="#10182b" stroke="#293755" stroke-width="2"/>
        <text x="${x + cardWidth - 24}" y="${y + 44}" text-anchor="end" class="slot">${String(screenshot.slot).padStart(2, "0")}</text>
        ${headline}
        ${caption}
      `;
    })
    .join("");

  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .title { fill: #f8fafc; font: 700 56px Arial, Helvetica, sans-serif; }
        .draft { fill: #c4b5fd; font: 700 25px Arial, Helvetica, sans-serif; letter-spacing: 1.4px; }
        .headline { fill: #f8fafc; font: 700 29px Arial, Helvetica, sans-serif; }
        .caption { fill: #a8b3c7; font: 400 20px Arial, Helvetica, sans-serif; }
        .slot { fill: #9b5cff; font: 700 25px Arial, Helvetica, sans-serif; }
      </style>
      <rect width="${width}" height="${height}" fill="#050817"/>
      <circle cx="2140" cy="30" r="400" fill="#6d28d9" opacity="0.16"/>
      <circle cx="2250" cy="1800" r="500" fill="#0891b2" opacity="0.12"/>
      <text x="${margin}" y="78" class="title">FlowLedger Founding Free</text>
      <text x="${margin}" y="125" class="draft">${xmlEscape(platformConfig.label.toUpperCase())} · PWA DRAFT · FICTIONAL REVIEWER DATA</text>
      <text x="${margin}" y="158" class="caption">Recapture from a signed native release build before store submission.</text>
      ${cards}
    </svg>
  `);
}

async function buildContactSheet(platform, platformConfig, screenshotCopy, rawDirectory, platformDirectory) {
  const { width, height, columns, rows, margin, columnGap, rowGap, headerHeight } = CONTACT_SHEET;
  const cardWidth = Math.floor((width - margin * 2 - columnGap * (columns - 1)) / columns);
  const cardHeight = Math.floor(
    (height - headerHeight - margin * 2 - rowGap * (rows - 1)) / rows,
  );
  const screenshotTopPadding = 150;
  const screenshotBottomPadding = 26;
  const maximumThumbnailHeight = cardHeight - screenshotTopPadding - screenshotBottomPadding;
  const overlays = [
    {
      input: createContactSheetSvg(platformConfig, screenshotCopy, cardWidth, cardHeight),
      left: 0,
      top: 0,
    },
  ];

  for (const [index, screenshot] of screenshotCopy.sequence.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cardX = margin + column * (cardWidth + columnGap);
    const cardY = headerHeight + margin + row * (cardHeight + rowGap);
    const thumbnail = await sharp(path.join(rawDirectory, screenshot.file))
      .resize({ height: maximumThumbnailHeight, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer({ resolveWithObject: true });
    overlays.push({
      input: thumbnail.data,
      left: cardX + Math.floor((cardWidth - thumbnail.info.width) / 2),
      top: cardY + screenshotTopPadding,
    });
  }

  const outputPath = path.join(platformDirectory, "contact-sheet.png");
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#050817",
    },
  })
    .composite(overlays)
    .toColourspace("srgb")
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
    .toFile(outputPath);

  const record = await inspectImage(outputPath);
  requireDimensions(record, width, height, `${platform} contact sheet`);
  requireStoreColor(record, `${platform} contact sheet`);
  return record;
}

async function buildPlatform(platform, platformConfig, screenshotCopy) {
  const platformDirectory = path.join(draftRoot, platform);
  const rawDirectory = path.join(platformDirectory, "raw");
  const storeDirectory = path.join(platformDirectory, "store");
  await validateRawDirectory(rawDirectory, screenshotCopy, platform);
  await mkdir(storeDirectory, { recursive: true });

  const files = [];
  for (const screenshot of screenshotCopy.sequence) {
    const rawPath = path.join(rawDirectory, screenshot.file);
    const outputPath = path.join(storeDirectory, screenshot.file);
    const { record: rawRecord, normalizedFrom } = await normalizeRawCapture(rawPath);
    requireDimensions(
      rawRecord,
      platformConfig.rawWidth,
      platformConfig.rawHeight,
      `${platform}/${screenshot.file}`,
    );

    await sharp(rawPath, { limitInputPixels: false })
      .resize(platformConfig.outputWidth, platformConfig.outputHeight, {
        fit: "fill",
        kernel: sharp.kernel.lanczos3,
      })
      .flatten({ background: "#050817" })
      .toColourspace("srgb")
      .removeAlpha()
      .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
      .toFile(outputPath);

    const outputRecord = await inspectImage(outputPath);
    requireDimensions(
      outputRecord,
      platformConfig.outputWidth,
      platformConfig.outputHeight,
      `${platform} store output ${screenshot.file}`,
    );
    requireStoreColor(outputRecord, `${platform} store output ${screenshot.file}`);

    files.push({
      slot: screenshot.slot,
      screen: screenshot.screen,
      headline: screenshot.headline,
      caption: screenshot.caption,
      raw: rawRecord,
      captureNormalization: normalizedFrom
        ? "Chrome screenshot transport returned JPEG bytes; normalized to opaque PNG without changing UI content."
        : null,
      store: outputRecord,
    });
  }

  requireUniqueScreenshotContent(files, platform);

  const contactSheet = await buildContactSheet(
    platform,
    platformConfig,
    screenshotCopy,
    rawDirectory,
    platformDirectory,
  );

  return {
    label: platformConfig.label,
    sourceKind: "Local PWA reviewer-capture draft",
    submissionReady: false,
    rawCaptureDimensions: `${platformConfig.rawWidth}x${platformConfig.rawHeight}`,
    storeOutputDimensions: `${platformConfig.outputWidth}x${platformConfig.outputHeight}`,
    outputColorMode: "24-bit RGB, no alpha",
    scaling:
      "Exact 3x resize with Lanczos3 resampling for readable CSS-DPR1 text; no UI content is added, removed, or altered.",
    files,
    contactSheet,
  };
}

async function main() {
  const platforms = parseArguments(process.argv.slice(2));
  const screenshotCopy = await readScreenshotCopy();
  const results = {};

  for (const platform of platforms) {
    results[platform] = await buildPlatform(
      platform,
      PLATFORM_CONFIGS[platform],
      screenshotCopy,
    );
  }

  const preferredContactPlatform = results["android-phone"] ? "android-phone" : platforms[0];
  const preferredContactPath = path.join(draftRoot, preferredContactPlatform, "contact-sheet.png");
  const sharedContactPath = path.join(draftRoot, "contact-sheet.png");
  await copyFile(preferredContactPath, sharedContactPath);
  const sharedContactSheet = await inspectImage(sharedContactPath);
  requireDimensions(
    sharedContactSheet,
    CONTACT_SHEET.width,
    CONTACT_SHEET.height,
    "shared contact sheet",
  );
  requireStoreColor(sharedContactSheet, "shared contact sheet");

  const manifest = {
    schemaVersion: 1,
    assetClass: "FlowLedger Founding Free PWA screenshot drafts",
    submissionReady: false,
    disclosure:
      "These images are fictional-data PWA drafts for composition and copy review. They must be recaptured from the signed native release candidate before App Store or Google Play submission.",
    generatedAt: new Date().toISOString(),
    generatedBy: "scripts/build-store-screenshot-drafts.mjs",
    fixture:
      "Local-only reviewer capture mode: artifacts/mobile/context/BudgetContext.tsx#createDemoBudgetData",
    copy: "screenshots/draft-pwa/copy.json",
    sequence: screenshotCopy.sequence,
    platforms: results,
    contactSheet: sharedContactSheet,
    approvalGate: {
      nativeRecaptureRequired: true,
      nativeMetadataRequired:
        "Record device model, OS, app version/build, fixture version, locale, display scale, and SHA-256 after signed-build capture.",
      manualPrivacyReviewRequired:
        "Confirm each image contains fictional data only and no credentials, email addresses, notifications, debug overlays, or other apps.",
    },
  };

  await writeFile(generatedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Built ${platforms.join(", ")} PWA draft screenshot assets.`);
  console.log(`Manifest: ${relativeAssetPath(generatedManifestPath)}`);
  console.log(`Contact sheet: ${relativeAssetPath(sharedContactPath)}`);
  console.log("Submission status: BLOCKED pending signed native recapture.");
}

main().catch((error) => {
  console.error(`Store screenshot draft build failed: ${error.message}`);
  process.exitCode = 1;
});
