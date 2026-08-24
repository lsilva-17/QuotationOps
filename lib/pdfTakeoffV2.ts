import type { Opening } from "@/lib/domain";

type Token = { str: string; x: number; y: number; width: number };

export type PdfTakeoffResult = {
  openings: Opening[];
  pages: number;
  summary: { declaredQuantity?: number; declaredTotalSqm?: number };
  warnings: string[];
};

const ITEM_REFERENCE = /^(?:[A-Z]{1,3}\d*-)?(?:GD|W|SG)\d+(?:\+W?\d+)?$/i;
const LEVEL_LABEL = /^(LOWER GROUND(?:\s+\d+)?|GROUND FLOOR|LEVEL\s+\d+)$/i;

const clean = (value: string) => value.replace(/\s+/g, " ").trim();

function asNumber(value: string) {
  const candidate = value.replace(/[$,]/g, "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(candidate)) return undefined;
  const number = Number(candidate);
  return Number.isFinite(number) ? number : undefined;
}

function textInColumn(tokens: Token[], minX: number, maxX: number) {
  return tokens
    .filter((token) => token.x >= minX && token.x < maxX)
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .map((token) => clean(token.str))
    .filter(Boolean);
}

function closestNumber(tokens: Token[], y: number, minX: number, maxX: number) {
  return tokens
    .map((token) => ({ token, value: asNumber(token.str), distance: Math.abs(token.y - y) }))
    .filter(
      (entry): entry is { token: Token; value: number; distance: number } =>
        entry.value !== undefined && entry.token.x >= minX && entry.token.x < maxX && entry.distance <= 42
    )
    .sort((a, b) => a.distance - b.distance)[0]?.value;
}

function rowBlock(tokens: Token[], y: number, previousY?: number, nextY?: number) {
  const upper = previousY === undefined ? y + 80 : (previousY + y) / 2;
  const lower = nextY === undefined ? y - 80 : (y + nextY) / 2;
  return tokens.filter((token) => token.y <= upper && token.y >= lower);
}

function description(block: Token[], pageWidth: number) {
  const values = textInColumn(block, pageWidth * 0.285, pageWidth * 0.595);
  const labelIndex = values.findIndex((value) => /^Type\/Series$/i.test(value));
  if (labelIndex >= 0 && values[labelIndex + 1]) return values[labelIndex + 1];
  return values.find((value) => /Sliding Door|Awning Window|Fixed Window|Hinged Door/i.test(value)) ?? "Unknown opening";
}

function spec(block: Token[], pageWidth: number, label: RegExp) {
  const values = textInColumn(block, pageWidth * 0.285, pageWidth * 0.595);
  const index = values.findIndex((value) => label.test(value));
  return index >= 0 ? values[index + 1] : undefined;
}

function category(value: string): Opening["category"] {
  const text = value.toLowerCase();
  if (text.includes("hinged door")) return "hinged_door";
  if (text.includes("sliding door")) return "sliding_door";
  if (text.includes("fixed window") && !text.includes("awning")) return "fixed_window";
  if (text.includes("awning")) return "awning_window";
  if (text.includes("window")) return "window";
  return "unknown";
}

function series(value: string) {
  return value.match(/\b(HDT\d+|C\d+(?:-P\d+)?)\b/i)?.[1];
}

async function pageTokens(page: { getTextContent: () => Promise<{ items: Array<unknown> }> }) {
  const content = await page.getTextContent();
  return content.items
    .filter((item): item is { str: string; transform: number[]; width: number } => {
      if (!item || typeof item !== "object") return false;
      const value = item as { str?: unknown; transform?: unknown; width?: unknown };
      return typeof value.str === "string" && Array.isArray(value.transform) && value.transform.length >= 6 && typeof value.width === "number";
    })
    .map((item) => ({ str: clean(item.str), x: item.transform[4], y: item.transform[5], width: item.width }))
    .filter((token) => token.str.length > 0);
}

export async function parseTakeoffPdf(data: Uint8Array, documentName: string): Promise<PdfTakeoffResult> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({ data, disableFontFace: true }).promise;
  const openings: Opening[] = [];
  const warnings: string[] = [];
  let carriedLevel: string | undefined;
  let declaredQuantity: number | undefined;
  let declaredTotalSqm: number | undefined;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const pageWidth = page.getViewport({ scale: 1 }).width;
    const tokens = await pageTokens(page);

    const sections = tokens
      .filter((token) => LEVEL_LABEL.test(token.str))
      .map((token) => ({ y: token.y, level: token.str.toUpperCase() }))
      .sort((a, b) => b.y - a.y);

    const qtyRows = tokens
      .map((token) => ({ token, value: asNumber(token.str) }))
      .filter(
        (entry): entry is { token: Token; value: number } =>
          entry.value !== undefined && Number.isInteger(entry.value) && entry.value > 0 && entry.token.x >= pageWidth * 0.885 && entry.token.x < pageWidth * 0.945
      )
      .sort((a, b) => b.token.y - a.token.y);

    for (let index = 0; index < qtyRows.length; index += 1) {
      const row = qtyRows[index];
      const block = rowBlock(tokens, row.token.y, qtyRows[index - 1]?.token.y, qtyRows[index + 1]?.token.y);
      const refs = textInColumn(block, pageWidth * 0.13, pageWidth * 0.215).filter((value) => ITEM_REFERENCE.test(value));
      if (!refs.length) continue;

      const widthMm = closestNumber(block, row.token.y, pageWidth * 0.59, pageWidth * 0.665);
      const heightMm = closestNumber(block, row.token.y, pageWidth * 0.665, pageWidth * 0.735);
      const quantity = row.value;
      const reference = refs.join(" + ");

      if (!widthMm || !heightMm) {
        warnings.push(`Page ${pageNumber}: ${reference} was found, but Width or Height could not be read.`);
        continue;
      }

      const itemDescription = description(block, pageWidth);
      const level = sections.filter((entry) => entry.y > row.token.y).sort((a, b) => a.y - b.y)[0]?.level ?? carriedLevel;
      const architecturalType = textInColumn(block, pageWidth * 0.205, pageWidth * 0.285).find((value) => /^TYPE-|^(?:FOYER|SAUNA|GYM|LIFT LOBBY)/i.test(value));

      openings.push({
        reference,
        level,
        architecturalType,
        category: category(itemDescription),
        series: series(itemDescription),
        widthMm,
        heightMm,
        quantity,
        specifications: {
          frame: spec(block, pageWidth, /^Frame$/i),
          glazing: spec(block, pageWidth, /^Double Glazing$/i),
          screen: spec(block, pageWidth, /^Screen\/Mesh$/i),
          installation: spec(block, pageWidth, /^Installation$/i),
          operatorLock: spec(block, pageWidth, /^Operator\/Lock$/i)
        },
        source: { documentName, page: pageNumber },
        confidence: 0.98,
        status: "confirmed",
        notes: []
      });
    }

    if (sections.length) carriedLevel = sections[sections.length - 1].level;

    const fullText = tokens.map((token) => token.str).join(" ");
    const quantityMatch = fullText.match(/Quantity:\s*(\d+)/i);
    const sqmMatch = fullText.match(/Quantity:\s*\d+\s+([\d,.]+)/i);
    if (quantityMatch) declaredQuantity = Number(quantityMatch[1]);
    if (sqmMatch) declaredTotalSqm = Number(sqmMatch[1].replace(/,/g, ""));
  }

  const unique = Array.from(new Map(openings.map((opening) => [`${opening.source.page}:${opening.reference}`, opening])).values());
  const extractedQuantity = unique.reduce((sum, opening) => sum + opening.quantity, 0);
  const calculatedSqm = unique.reduce((sum, opening) => sum + (opening.widthMm * opening.heightMm * opening.quantity) / 1_000_000, 0);

  if (declaredQuantity !== undefined && extractedQuantity !== declaredQuantity) {
    warnings.unshift(`PDF declares ${declaredQuantity} openings; extraction found ${extractedQuantity}. Review the flagged/skipped rows.`);
  }
  if (declaredTotalSqm !== undefined && Math.abs(calculatedSqm - declaredTotalSqm) > 0.5) {
    warnings.push(`PDF declares ${declaredTotalSqm.toFixed(2)} m²; Width × Height × QTY from extracted rows gives ${calculatedSqm.toFixed(2)} m².`);
  }

  return { openings: unique, pages: pdf.numPages, summary: { declaredQuantity, declaredTotalSqm }, warnings };
}
