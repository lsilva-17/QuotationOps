import { NextResponse } from "next/server";
import { parseTakeoffPdf } from "@/lib/pdfTakeoffV2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll("documents").filter((value): value is File => value instanceof File);

    if (!files.length) {
      return NextResponse.json({ error: "Upload at least one PDF." }, { status: 400 });
    }

    const results = await Promise.all(
      files.map(async (file) => {
        if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
          throw new Error(`${file.name} is not a PDF.`);
        }
        const buffer = new Uint8Array(await file.arrayBuffer());
        return parseTakeoffPdf(buffer, file.name);
      })
    );

    return NextResponse.json({
      openings: results.flatMap((result) => result.openings),
      pages: results.reduce((sum, result) => sum + result.pages, 0),
      warnings: results.flatMap((result) => result.warnings),
      declaredQuantity: results.map((result) => result.summary.declaredQuantity).find((value) => value !== undefined),
      declaredTotalSqm: results.map((result) => result.summary.declaredTotalSqm).find((value) => value !== undefined)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not analyse the PDF.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
