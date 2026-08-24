import { estimatedPrice, totalSqm, type Opening } from "@/lib/domain";

const SAMPLE_RATE = 700;

const openings: Opening[] = [
  {
    reference: "LG3-GD01",
    level: "LOWER GROUND 03",
    architecturalType: "TYPE-A1",
    category: "sliding_door",
    series: "HDT150",
    widthMm: 3150,
    heightMm: 2860,
    quantity: 1,
    specifications: {
      frame: "218.6mm×50mm",
      glazing: "5EuroGreyLowE/12Ar/5Clr",
      screen: "Alloy Mesh Flyscreen",
      installation: "Subframe",
      operatorLock: "D Lock"
    },
    source: { documentName: "Architectural Drawings.pdf", page: 1 },
    confidence: 0.98,
    status: "confirmed",
    notes: []
  },
  {
    reference: "LG3-GD02",
    level: "LOWER GROUND 03",
    architecturalType: "TYPE-A1",
    category: "sliding_door",
    series: "HDT150",
    widthMm: 3850,
    heightMm: 2860,
    quantity: 1,
    specifications: {
      frame: "218.6mm×50mm",
      glazing: "5EuroGreyLowE/12Ar/5Clr",
      screen: "Alloy Mesh Flyscreen",
      installation: "Subframe",
      operatorLock: "D Lock"
    },
    source: { documentName: "Architectural Drawings.pdf", page: 1 },
    confidence: 0.96,
    status: "confirmed",
    notes: []
  },
  {
    reference: "LG2-W07",
    level: "LOWER GROUND 02",
    architecturalType: "TYPE-C",
    category: "awning_window",
    series: "C101",
    widthMm: 950,
    heightMm: 2900,
    quantity: 2,
    specifications: {
      frame: "101.6mm×50mm",
      glazing: "5EuroGreyLowE/12Ar/5Clr",
      screen: "Alloy Mesh Flyscreen",
      installation: "Subframe",
      operatorLock: "Chain Winder"
    },
    source: { documentName: "Window Schedule.pdf", page: 7 },
    confidence: 0.71,
    status: "review_required",
    notes: ["Dimension differs from elevation drawing"]
  }
];

const totalArea = openings.reduce((sum, opening) => sum + totalSqm(opening), 0);
const totalValue = openings.reduce(
  (sum, opening) => sum + estimatedPrice(opening, SAMPLE_RATE),
  0
);
const reviewCount = openings.filter((opening) => opening.status !== "confirmed").length;

export default function Home() {
  return (
    <main className="shell">
      <header className="header">
        <div>
          <div className="brand">QuotationOps</div>
          <div className="muted">AI Takeoff & Budget Estimator</div>
        </div>
        <button className="primary" type="button">New project</button>
      </header>

      <section className="card">
        <h1>Castelle — Swann Road</h1>
        <p className="muted">Upload the builder's architectural PDF package and start a takeoff analysis.</p>
        <div className="formRow">
          <div className="field">
            <label htmlFor="documents">Project PDFs</label>
            <input id="documents" type="file" accept="application/pdf" multiple />
          </div>
          <div className="field">
            <label htmlFor="rate">Base price / m² (AUD)</label>
            <input id="rate" type="number" defaultValue={SAMPLE_RATE} min="0" step="0.01" />
          </div>
          <button className="primary" type="button">Start analysis</button>
        </div>
      </section>

      <section className="grid panel">
        <div className="card"><div className="muted">Openings</div><div className="metric">{openings.reduce((n, x) => n + x.quantity, 0)}</div></div>
        <div className="card"><div className="muted">Total area</div><div className="metric">{totalArea.toFixed(2)} m²</div></div>
        <div className="card"><div className="muted">Needs review</div><div className="metric">{reviewCount}</div></div>
        <div className="card"><div className="muted">Estimated value</div><div className="metric">A${totalValue.toLocaleString("en-AU", { maximumFractionDigits: 0 })}</div></div>
      </section>

      <section className="card panel">
        <div className="header">
          <div>
            <h2>Takeoff results</h2>
            <div className="muted">Every extracted item keeps its source page and confidence score.</div>
          </div>
          <button className="primary" type="button">Export Excel</button>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Reference</th><th>Type</th><th>Width</th><th>Height</th><th>Qty</th><th>SQM</th><th>Status</th><th>Source</th><th>Estimate</th>
              </tr>
            </thead>
            <tbody>
              {openings.map((opening) => (
                <tr key={opening.reference}>
                  <td><strong>{opening.reference}</strong><br /><span className="muted">{opening.level}</span></td>
                  <td>{opening.series} {opening.category.replaceAll("_", " ")}</td>
                  <td>{opening.widthMm} mm</td>
                  <td>{opening.heightMm} mm</td>
                  <td>{opening.quantity}</td>
                  <td>{totalSqm(opening).toFixed(3)}</td>
                  <td><span className="badge">{opening.status.replaceAll("_", " ")}</span><br /><span className="muted">{Math.round(opening.confidence * 100)}% confidence</span></td>
                  <td>{opening.source.documentName}<br /><span className="muted">Page {opening.source.page}</span></td>
                  <td>A${estimatedPrice(opening, SAMPLE_RATE).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
