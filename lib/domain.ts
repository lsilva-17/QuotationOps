import { z } from "zod";

export const openingStatusSchema = z.enum([
  "confirmed",
  "review_required",
  "unresolved"
]);

export const openingSchema = z.object({
  reference: z.string().min(1),
  level: z.string().optional(),
  architecturalType: z.string().optional(),
  category: z.enum([
    "window",
    "sliding_door",
    "hinged_door",
    "fixed_window",
    "awning_window",
    "facade",
    "unknown"
  ]),
  series: z.string().optional(),
  widthMm: z.number().positive(),
  heightMm: z.number().positive(),
  quantity: z.number().int().positive().default(1),
  specifications: z.object({
    frame: z.string().optional(),
    glazing: z.string().optional(),
    screen: z.string().optional(),
    installation: z.string().optional(),
    operatorLock: z.string().optional(),
    finish: z.string().optional()
  }),
  source: z.object({
    documentName: z.string(),
    page: z.number().int().positive()
  }),
  confidence: z.number().min(0).max(1),
  status: openingStatusSchema,
  notes: z.array(z.string()).default([])
});

export type Opening = z.infer<typeof openingSchema>;

export function unitSqm(opening: Pick<Opening, "widthMm" | "heightMm">) {
  return (opening.widthMm * opening.heightMm) / 1_000_000;
}

export function totalSqm(opening: Pick<Opening, "widthMm" | "heightMm" | "quantity">) {
  return unitSqm(opening) * opening.quantity;
}

export function estimatedPrice(
  opening: Pick<Opening, "widthMm" | "heightMm" | "quantity">,
  pricePerSqm: number
) {
  return totalSqm(opening) * pricePerSqm;
}
