"use client";

import { useMemo, useState } from "react";
import type { Opening } from "@/lib/domain";

const DEFAULT_RATE = 700;

type AnalysisResponse = {
  openings: Opening[];
  pages: number;
  warnings: string[];
  declaredQuantity?: number;
  declaredTotalSqm?: number;
  error?: string;
};

function unitSqm(opening: Opening) {
  return (opening.widthMm * opening.heightMm) / 1_000_000;
}

function totalSqm(opening: Opening) {
  return unitSqm(opening) * opening.quantity;
}

function estimatedPrice(opening: Opening, rate: number) {
  return totalSqm(opening) * rate;
}

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [pages, setPages] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [declaredQuantity, setDeclaredQuantity] = useState<number>();
  const [declaredTotalSqm, setDeclaredTotalSqm] = useState<number>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const totals = useMemo(() => {
    const quantity = openings.reduce((sum, opening) => sum + opening.quantity, 0);
    const area = openings.reduce((sum, opening) => sum + totalSqm(opening), 0);
    const value = openings.reduce((sum, opening) => sum + estimatedPrice(opening, rate), 0);
    return { quantity, area, value };
  }, [openings, rate]);

  async function analyse() {
    if (!files.length) {
      setError("Select at least one PDF first.");
      return;
    }

    setLoading(true);
    setError(undefined);
    setWarnings([]);

    try {
      const form = new FormData();
      files.forEach((file) => form.append("documents", file));
      const response = await fetch("/api/analyze", { method: "POST", body: form });
      const data = (await response.json()) as AnalysisResponse;
      if (!response.ok) throw new Error(data.error ?? "PDF analysis failed.");

      setOpenings(data.openings);
      setPages(data.pages);
      setWarnings(data.warnings ?? []);
      setDeclaredQuantity(data.declaredQuantity);
      setDeclaredTotalSqm(data.declaredTotalSqm);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PDF analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <header className="header">
        <div>
          <div className="brand">QuotationOps</div>
          <div className="muted">AI Takeoff & Budget Estimator</div>
        </div>
      </header>

      <section className="card">
        <h1>Project takeoff</h1>
        <p className="muted">Upload the quotation or takeoff PDFs. Rows are identified from Item No. and QTY; SQM is recalculated from Width × Height × QTY.</p>
        <div className="formRow">
          <div className="field">
            <label htmlFor="documents">Project PDFs</label>
            <input
              id="documents"
              type="file"
              accept="application/pdf"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </div>
          <div className="field">
            <label htmlFor="rate">Base price / m² (AUD)</label>
            <input
              id="rate"
              type="number"
              value={rate}
              min="0"
              step="0.01"
              onChange={(event) => setRate(Math.max(0, Number(event.target.value) || 0))}
            />
          </div>
          <button className="primary" type="button" onClick={analyse} disabled={loading || !files.length}>
            {loading ? "Analysing…" : "Start analysis"}
          </button>
        </div>
        {error ? <p><strong>{error}</strong></p> : null}
        {warnings.length ? (
          <div className="panel">
            {warnings.slice(0, 8).map((warning) => <div key={warning} className="muted">⚠ {warning}</div>)}
            {warnings.length > 8 ? <div className="muted">+ {warnings.length - 8} more extraction warnings</div> : null}
          </div>
        ) : null}
      </section>

      <section className="grid panel">
        <div className="card"><div className="muted">Openings / QTY</div><div className="metric">{totals.quantity}</div>{declaredQuantity ? <div className="muted">PDF total: {declaredQuantity}</div> : null}</div>
        <div className="card"><div className="muted">Total area</div><div className="metric">{totals.area.toFixed(2)} m²</div>{declaredTotalSqm ? <div className="muted">PDF total: {declaredTotalSqm.toFixed(2)} m²</div> : null}</div>
        <div className="card"><div className="muted">Rows extracted</div><div className="metric">{openings.length}</div><div className="muted">Across {pages} pages</div></div>
        <div className="card"><div className="muted">Estimated value</div><div className="metric">A${totals.value.toLocaleString("en-AU", { maximumFractionDigits: 0 })}</div></div>
      </section>

      <section className="card panel">
        <div className="header">
          <div>
            <h2>Takeoff results</h2>
            <div className="muted">Every table row keeps Item No., QTY, dimensions and source page. SQM never trusts the source PDF calculation.</div>
          </div>
          <button className="primary" type="button" disabled={!openings.length}>Export Excel</button>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Item No.</th><th>Type</th><th>Width</th><th>Height</th><th>QTY</th><th>Unit SQM</th><th>Total SQM</th><th>Source</th><th>Estimate</th>
              </tr>
            </thead>
            <tbody>
              {openings.map((opening, index) => (
                <tr key={`${opening.source.documentName}-${opening.source.page}-${opening.reference}-${index}`}>
                  <td><strong>{opening.reference}</strong><br /><span className="muted">{opening.level}</span></td>
                  <td>{opening.series ?? "—"} {opening.category.replaceAll("_", " ")}</td>
                  <td>{opening.widthMm} mm</td>
                  <td>{opening.heightMm} mm</td>
                  <td><strong>{opening.quantity}</strong></td>
                  <td>{unitSqm(opening).toFixed(3)}</td>
                  <td><strong>{totalSqm(opening).toFixed(3)}</strong></td>
                  <td>{opening.source.documentName}<br /><span className="muted">Page {opening.source.page}</span></td>
                  <td>A${estimatedPrice(opening, rate).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!openings.length && !loading ? <p className="muted">No analysis yet.</p> : null}
        </div>
      </section>
    </main>
  );
}
