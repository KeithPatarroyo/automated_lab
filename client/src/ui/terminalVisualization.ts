import type { TerminalCalibrationPoint, TerminalScatterPoint, TerminalStructureSnapshot } from "@lab/shared";

interface ScatterData {
  points: TerminalScatterPoint[];
  targetProperty: "informationContent" | "bulkModulus";
  targetMin?: number;
  targetMax?: number;
}

// Colors are deliberately distinct from the retro-green terminal chrome so the diagrams
// read as "data" rather than blending into the CRT-styled frame around them.
const LAYER_COLOR: Record<string, string> = { H: "#8fd0ff", C: "#ffb37a" };
const MECHANISM_COLOR: Record<string, string> = { thermal: "#ff6b6b", contaminant: "#c792ea", growth: "#82e6a1" };
const DEFAULT_POINT_COLOR = "#888";

function escapeXml(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
}

/** Renders the best-so-far synthesized structure as a vertical layer-stack diagram -
 * one colored bar per stacking symbol (H/C), the same visual convention polytype
 * stacking diagrams in the literature use. All synthetic/fictional data - see the
 * "chaotic layered crystals" science task. */
export function renderStructureSvg(structure: TerminalStructureSnapshot | null): string {
  const width = 200;
  const height = 220;
  if (!structure) {
    return (
      `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<text x="${width / 2}" y="${height / 2}" fill="#3ddc84" font-size="11" text-anchor="middle" opacity="0.6">No structure synthesized yet</text>` +
      `</svg>`
    );
  }

  const chars = structure.sequence.split("");
  const stackTop = 12;
  const stackHeight = 160;
  const stackLeft = 60;
  const stackWidth = 60;
  const layerHeight = stackHeight / chars.length;

  const layers = chars
    .map((c, i) => {
      const y = stackTop + i * layerHeight;
      const fill = LAYER_COLOR[c] ?? "#555";
      return `<rect x="${stackLeft}" y="${y.toFixed(2)}" width="${stackWidth}" height="${(layerHeight + 0.5).toFixed(2)}" fill="${fill}" stroke="#06120a" stroke-width="0.5" />`;
    })
    .join("");

  const statusColor = structure.meetsTarget ? "#3ddc84" : "#ffcf6b";
  const statusText = structure.meetsTarget ? "meets target" : "below target";

  return (
    `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    `<text x="${width / 2}" y="10" fill="#3ddc84" font-size="10" text-anchor="middle">${escapeXml(structure.material)} · ${escapeXml(structure.mechanism)}-faulted</text>` +
    layers +
    `<rect x="${stackLeft}" y="${stackTop}" width="${stackWidth}" height="${stackHeight}" fill="none" stroke="#3ddc84" stroke-width="1" />` +
    `<circle cx="16" cy="${stackTop + 6}" r="4" fill="${LAYER_COLOR.H}" /><text x="24" y="${stackTop + 9}" fill="#9ec9b0" font-size="9">H</text>` +
    `<circle cx="16" cy="${stackTop + 20}" r="4" fill="${LAYER_COLOR.C}" /><text x="24" y="${stackTop + 23}" fill="#9ec9b0" font-size="9">C</text>` +
    `<text x="${width / 2}" y="${stackTop + stackHeight + 16}" fill="#9ec9b0" font-size="9" text-anchor="middle">info: ${structure.informationContent.toFixed(2)} · bulk: ${structure.bulkModulus.toFixed(1)}</text>` +
    `<text x="${width / 2}" y="${stackTop + stackHeight + 30}" fill="${statusColor}" font-size="9" text-anchor="middle">${statusText}</text>` +
    `</svg>`
  );
}

/** Renders the property landscape (information content vs. bulk modulus) across recent
 * runs as a scatter plot, colored by faulting mechanism, with a dashed reference line
 * at the current target threshold. */
export function renderScatterSvg(scatter: ScatterData): string {
  const width = 260;
  const height = 220;
  const marginLeft = 34;
  const marginBottom = 24;
  const marginTop = 16;
  const marginRight = 10;
  const plotW = width - marginLeft - marginRight;
  const plotH = height - marginTop - marginBottom;

  if (scatter.points.length === 0) {
    return (
      `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<text x="${width / 2}" y="${height / 2}" fill="#3ddc84" font-size="11" text-anchor="middle" opacity="0.6">No runs logged yet</text>` +
      `</svg>`
    );
  }

  const xs = scatter.points.map((p) => p.informationContent);
  const ys = scatter.points.map((p) => p.bulkModulus);
  const pad = (min: number, max: number) => (max - min || 1) * 0.1;
  const xMin = Math.min(...xs) - pad(Math.min(...xs), Math.max(...xs));
  const xMax = Math.max(...xs) + pad(Math.min(...xs), Math.max(...xs));
  const yMin = Math.min(...ys) - pad(Math.min(...ys), Math.max(...ys));
  const yMax = Math.max(...ys) + pad(Math.min(...ys), Math.max(...ys));

  const px = (x: number) => marginLeft + ((x - xMin) / (xMax - xMin)) * plotW;
  const py = (y: number) => marginTop + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

  const points = scatter.points
    .map((p) => {
      const color = MECHANISM_COLOR[p.mechanism] ?? DEFAULT_POINT_COLOR;
      const r = p.meetsTarget ? 3.5 : 2.5;
      const stroke = p.meetsTarget ? `stroke="#fff" stroke-width="0.75"` : "";
      return `<circle cx="${px(p.informationContent).toFixed(1)}" cy="${py(p.bulkModulus).toFixed(1)}" r="${r}" fill="${color}" fill-opacity="0.85" ${stroke} />`;
    })
    .join("");

  let targetLine = "";
  if (scatter.targetProperty === "informationContent" && scatter.targetMin !== undefined) {
    const x = px(scatter.targetMin);
    targetLine = `<line x1="${x.toFixed(1)}" y1="${marginTop}" x2="${x.toFixed(1)}" y2="${marginTop + plotH}" stroke="#3ddc84" stroke-width="1" stroke-dasharray="3,2" opacity="0.6" />`;
  } else if (scatter.targetProperty === "bulkModulus" && scatter.targetMin !== undefined) {
    const y = py(scatter.targetMin);
    targetLine = `<line x1="${marginLeft}" y1="${y.toFixed(1)}" x2="${marginLeft + plotW}" y2="${y.toFixed(1)}" stroke="#3ddc84" stroke-width="1" stroke-dasharray="3,2" opacity="0.6" />`;
  }

  const mechanisms = Array.from(new Set(scatter.points.map((p) => p.mechanism)));
  const legend = mechanisms
    .map((m, i) => {
      const y = marginTop + i * 11;
      return `<circle cx="${width - 6}" cy="${y}" r="3" fill="${MECHANISM_COLOR[m] ?? DEFAULT_POINT_COLOR}" /><text x="${width - 12}" y="${y + 3}" fill="#9ec9b0" font-size="8" text-anchor="end">${escapeXml(m)}</text>`;
    })
    .join("");

  return (
    `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    `<line x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${marginTop + plotH}" stroke="#3ddc84" stroke-width="1" opacity="0.5" />` +
    `<line x1="${marginLeft}" y1="${marginTop + plotH}" x2="${marginLeft + plotW}" y2="${marginTop + plotH}" stroke="#3ddc84" stroke-width="1" opacity="0.5" />` +
    targetLine +
    points +
    `<text x="${(marginLeft + plotW / 2).toFixed(1)}" y="${height - 4}" fill="#9ec9b0" font-size="9" text-anchor="middle">information content</text>` +
    `<text x="10" y="${(marginTop + plotH / 2).toFixed(1)}" fill="#9ec9b0" font-size="9" text-anchor="middle" transform="rotate(-90 10 ${(marginTop + plotH / 2).toFixed(1)})">bulk modulus</text>` +
    legend +
    `</svg>`
  );
}

const PARITY_PROPERTY_LABEL: Record<"informationContent" | "bulkModulus", string> = {
  informationContent: "information content",
  bulkModulus: "bulk modulus",
};

/** Renders a theory-vs-experiment parity plot for one property: x = the noise-free
 * theoretical prediction, y = the actual (noisy) measured value, with a vertical error
 * bar per point showing the real instrument uncertainty, and a dashed y=x reference
 * line - perfect agreement would put every point exactly on that line. Lab terminal
 * only (see terminalVisualization.ts's "calibration" kind). */
export function renderParitySvg(points: TerminalCalibrationPoint[], property: "informationContent" | "bulkModulus"): string {
  const width = 260;
  const height = 220;
  const marginLeft = 34;
  const marginBottom = 24;
  const marginTop = 16;
  const marginRight = 10;
  const plotW = width - marginLeft - marginRight;
  const plotH = height - marginTop - marginBottom;
  const label = PARITY_PROPERTY_LABEL[property];

  if (points.length === 0) {
    return (
      `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
      `<text x="${width / 2}" y="${height / 2}" fill="#3ddc84" font-size="11" text-anchor="middle" opacity="0.6">No measurements yet</text>` +
      `</svg>`
    );
  }

  const extract = (p: TerminalCalibrationPoint): { theoretical: number; experimental: number; uncertainty: number } =>
    property === "informationContent"
      ? { theoretical: p.theoreticalInformationContent, experimental: p.experimentalInformationContent, uncertainty: p.informationContentUncertainty }
      : { theoretical: p.theoreticalBulkModulus, experimental: p.experimentalBulkModulus, uncertainty: p.bulkModulusUncertainty };

  const allValues = points.flatMap((p) => {
    const v = extract(p);
    return [v.theoretical, v.experimental - v.uncertainty, v.experimental + v.uncertainty];
  });
  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const pad = (rawMax - rawMin || 1) * 0.1;
  const domainMin = rawMin - pad;
  const domainMax = rawMax + pad;

  // Same domain on both axes (a parity plot needs matching scales for y=x to mean
  // anything), mapped independently through the plot rectangle's actual width/height.
  const px = (v: number) => marginLeft + ((v - domainMin) / (domainMax - domainMin)) * plotW;
  const py = (v: number) => marginTop + plotH - ((v - domainMin) / (domainMax - domainMin)) * plotH;

  const referenceLine =
    `<line x1="${px(domainMin).toFixed(1)}" y1="${py(domainMin).toFixed(1)}" x2="${px(domainMax).toFixed(1)}" y2="${py(domainMax).toFixed(1)}" ` +
    `stroke="#3ddc84" stroke-width="1" stroke-dasharray="3,2" opacity="0.5" />`;

  const marks = points
    .map((p) => {
      const v = extract(p);
      const x = px(v.theoretical);
      const yTop = py(v.experimental + v.uncertainty);
      const yBottom = py(v.experimental - v.uncertainty);
      const yCenter = py(v.experimental);
      const color = MECHANISM_COLOR[p.mechanism] ?? DEFAULT_POINT_COLOR;
      const r = p.meetsTarget ? 3.2 : 2.4;
      const stroke = p.meetsTarget ? `stroke="#fff" stroke-width="0.75"` : "";
      const errorBar =
        `<line x1="${x.toFixed(1)}" y1="${yTop.toFixed(1)}" x2="${x.toFixed(1)}" y2="${yBottom.toFixed(1)}" stroke="${color}" stroke-width="1" opacity="0.55" />` +
        `<line x1="${(x - 2).toFixed(1)}" y1="${yTop.toFixed(1)}" x2="${(x + 2).toFixed(1)}" y2="${yTop.toFixed(1)}" stroke="${color}" stroke-width="1" opacity="0.55" />` +
        `<line x1="${(x - 2).toFixed(1)}" y1="${yBottom.toFixed(1)}" x2="${(x + 2).toFixed(1)}" y2="${yBottom.toFixed(1)}" stroke="${color}" stroke-width="1" opacity="0.55" />`;
      return `${errorBar}<circle cx="${x.toFixed(1)}" cy="${yCenter.toFixed(1)}" r="${r}" fill="${color}" fill-opacity="0.9" ${stroke} />`;
    })
    .join("");

  return (
    `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    `<line x1="${marginLeft}" y1="${marginTop}" x2="${marginLeft}" y2="${marginTop + plotH}" stroke="#3ddc84" stroke-width="1" opacity="0.5" />` +
    `<line x1="${marginLeft}" y1="${marginTop + plotH}" x2="${marginLeft + plotW}" y2="${marginTop + plotH}" stroke="#3ddc84" stroke-width="1" opacity="0.5" />` +
    referenceLine +
    marks +
    `<text x="${(marginLeft + plotW / 2).toFixed(1)}" y="${height - 4}" fill="#9ec9b0" font-size="9" text-anchor="middle">theoretical ${label}</text>` +
    `<text x="10" y="${(marginTop + plotH / 2).toFixed(1)}" fill="#9ec9b0" font-size="9" text-anchor="middle" transform="rotate(-90 10 ${(marginTop + plotH / 2).toFixed(1)})">measured ${label}</text>` +
    `</svg>`
  );
}
