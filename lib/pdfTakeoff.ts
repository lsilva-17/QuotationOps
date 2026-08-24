import type { Opening } from "@/lib/domain";

type TextToken = {
  str: string;
  x: number;
  y: number;
  width: number;
};

type ParsedPdfSummary = {
  declaredQuantity?: number;
  declaredTotalSqm?: number;
};

export type PdfTakeoffResult = {
  openings: Opening[];
  pages: number;
  summary: ParsedPdfSummary;
  warnings: string[];
};

const ITEM_REFERENCE = /^(?:[A-Z]{1,3}\d*-)?(?:GD|W|SG)\d+(?:\+W?\d+)?$/i;
const LEVEL_LABEL = /^(LOWER GROUND(?:\s+\d+)?|GROUND FLOOR|LEVEL\s+\d+)$/i;

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function parseNumber(value: string) {
  const cleaned = value.replace(/[$,]/g, "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function categoryFromDescription(description: string): Opening["category"] {
  const normalized = description.toLowerCase();
  if (normalized.includes("hinged door")) return "hinged_door";
  if (normalized.includes("sliding door")) return "sliding_door";
  if (normalized.includes("fixed window") && !normalized.includes("awning")) return "fixed_window";
  if (normalized.includes("awning")) return "awning_window";
  if (normalized.includes("window")) return "window";
  return "unknown";
}

function seriesFromDescription(description: string) {
  return description.match(/\b(HDT\d+|C\d+(?:-P\d+)?)\b/i)?.[1];
}

function closestNumericToken(
  tokens: TextToken[],
  targetY: number,
  minX: number,
  maxX: number,
  maxDistance = 34
) {
  return tokens
    .map((token) => ({ token, value: parseNumber(token.str), distance: Math.abs(token.y - targetY) }))
    .filter(
      (entry): entry is { token: TextToken; value: number; distance: number } =>
        entry.value !== undefined &&
        entry.token.x >= minX &&
        entry.token.x < maxX &&
        entry.distance <= maxDistance
    )
    .sort((a, b) => a.distance - b.distance)[0];
}

function blockTokens(tokens: TextToken[], y: number, previousY?: number, nextY?: number) {
  const upper = previousY === undefined ? y + 70 : (previousY + y) / 2;
  const lower = nextY === undefined ? y - 70 : (y + nextY) / 2;
  return tokens.filter((token) => token.y <= upper && token.y >= lower);
}

function textAtColumn(tokens: TextToken[], minX: number, maxX: number) {
  return tokens
    .filter((token) => token.x >= minX && token.x < maxX)
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .map((token) => normalizeText(token.str))
    .filter(Boolean);
}

function descriptionFromBlock(tokens: TextToken[], pageWidth: number) {
  const descriptionTokens = textAtColumn(tokens, pageWidth * 0.285, pageWidth * 0.595);
  const typeIndex = descriptionTokens.findIndex((token) => /^Type\/Series$/i.test(token));
  if (typeIndex >= 0 && descriptionTokens[typeIndex + 1]) return descriptionTokens[typeIndex + 1];

  return (
    descriptionTokens.find((token) => /\b(?:Sliding Door|Awning Window|Fixed Window|Hinged Door)\b/i.test(token)) ??
    "Unknown opening"
  );
}

function specificationValue(tokens: TextToken[], label: RegExp, pageWidth: number) {
  const descriptionTokens = textAtColumn(tokens, pageWidth * 0.285, pageWidth * 0.595);
  const index = descriptionTokens.findIndex((token) => label.test(token));
  return index >= 0 ? descriptionTokens[index + 1] : undefined;
}

function levelForReference(
  referenceY: number,
  sectionMarkers: Array<{ y: number; level: string }>,
  carriedLevel?: string
) {
  const marker = sectionMarkers
    .filter((entry) => entry.y > referenceY)
    .sort((a, b) => a.y - b.y)[0];
  return marker?.level ?? carriedLevel;
}

async function extractPageTokens(page: {
  getTextContent: () => Promise<{ items: Array<unknown> }>;
}) {
  const content = await page.getTextContent();
  return content.items
    .filter((item): item is { str: string; transform: number[]; width: number } => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as { str?: unknown; transform?: unknown; width?: unknown };
      return (
        typeof candidate.str === "string" &&
        Array.isArray(candidate.transform) &&
        candidate.transform.length >= 6 &&
        typeof candidate.width === "number"
      );
    })
    .map((item) => ({
      str: normalizeText(item.str),
      x: item.transform[4],
      y: item.transform[5],
      width: item.width
    }))
    .filter((token) => token.str.length > 0);
}

export async function parseTakeoffPdf(data: Uint8Array, documentName: string): Promise<PdfTakeoffResult> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data, disableFontFace: true });
  const pdf = await loadingTask.promise;

  const openings: Opening[] = [];
  const warnings: string[] = [];
  let carriedLevel: string | undefined;
  let declaredQuantity: number | undefined;
  let declaredTotalSqm: number | undefined;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const pageWidth = viewport.width;
    const tokens = await extractPageTokens(page);

    const sectionMarkers = tokens
      .filter((token) => LEVEL_LABEL.test(token.str))
      .map((token) => ({ y: token.y, level: token.str.toUpperCase() }))
      .sort((a, b) => b.y - a.y);

    const references = tokens
      .filter((token) => ITEM_REFERENCE.test(token.str))
      .sort((a, b) => b.y - a.y);

    for (let index = 0; index < references.length; index += 1) {
      const reference = references[index];
      const previous = references[index - 1];
      const next = references[index + 1];
      const block = blockTokens(tokens, reference.y, previous?.y, next?.y);

      const widthToken = closestNumericToken(
        block,
        reference.y,
        pageWidth * 0.59,
        pageWidth * 0.665
      );
      const heightToken = closestNumericToken(
        block,
        reference.y,
        pageWidth * 0.665,
        pageWidth * 0.735
      );
      const qtyToken = closestNumericToken(
        block,
        reference.y,
        pageWidth * 0.885,
        pageWidth * 0.945
      );

      const widthMm = widthToken?.value;
      const heightMm = heightToken?.value;
      const quantity = qtyToken?.value;

      if (!widthMm || !heightMm || !quantity || !Number.isInteger(quantity)) {
        warnings.push(
          `Page ${pageNumber}: skipped ${reference.str} because Width, Height or QTY could not be read reliably.`
        );
        continue;
      }

      const description = descriptionFromBlock(block, pageWidth);
      const level = levelForReference(reference.y, sectionMarkers, carriedLevel);
      const location = textAtColumn(block, pageWidth * 0.205, pageWidth * 0.285)
        .find((value) => /^TYPE-|^(?:FOYER|SAUNA|GYM|LIFT LOBBY)/i.test(value));

      openings.push({
        reference: reference.str,
        level,
        architecturalType: location,
        category: categoryFromDescription(description),
        series: seriesFromDescription(description),
        widthMm,
        heightMm,
        quantity,
        specifications: {
          frame: specificationValue(block, /^Frame$/i, pageWidth),
          glazing: specificationValue(block, /^Double Glazing$/i, pageWidth),
          screen: specificationValue(block, /^Screen\/Mesh$/i, pageWidth),
          installation: specificationValue(block, /^Installation$/i, pageWidth),
          operatorLock: specificationValue(block, /^Operator\/Lock$/i, pageWidth)
        },
        source: { documentName, page: pageNumber },
        confidence: 0.95,
        status: "confirmed",
        notes: []
      });
    }

    if (sectionMarkers.length > 0) {
      carriedLevel = sectionMarkers[sectionMarkers.length - 1].level;
    }

    const joinedText = tokens.map((token) => token.str).join(" ");
    const quantityMatch = joinedText.match(/Quantity:\s*(\d+)/i);
    const totalSqmMatch = joinedText.match(/Quantity:\s*\d+\s+([\d,.]+)/i);
    if (quantityMatch) declaredQuantity = Number(quantityMatch[1]);
    if (totalSqmMatch) declaredTotalSqm = Number(totalSqmMatch[1].replace(/,/g, ""));
  }

  const uniqueOpenings = Array.from(
    new Map(openings.map((opening) => [`${opening.source.page}:${opening.reference}`, opening])).values()
  );

  const extractedQuantity = uniqueOpenings.reduce((sum, opening) => sum + opening.quantity, 0);
  if (declaredQuantity !== undefined && extractedQuantity !== declaredQuantity) {
    warnings.unshift(
      `PDF declares ${declaredQuantity} openings, but ${extractedQuantity} were extracted. Review skipped rows before using the estimate.`
    );
  }

  return {
    openings: uniqueOpenings,
    pages: pdf.numPages,
    summary: { declaredQuantity, declaredTotalSqm },
    warnings
  };
}
