import type { ReactNode } from "react";
import { barX, barY, binX, cell, defineChart, dot, lineY, rect, stack } from "@tanstack/charts";
import { pie, polar, radialArc } from "@tanstack/charts/polar";
import { Chart } from "@tanstack/charts/react";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleUtc } from "@tanstack/charts/scales/time";
import type { ChartInput, WorkProps } from "@abracode/contracts/web/catalog";

const palette = ["#568661", "#5286b2", "#d29449", "#9c72ae", "#cb726b", "#459e9b"];
const category = {
  scale: () => scaleBand<string>().padding(0.2),
  axis: {
    ticks: { format: (label: string) => (label.length <= 18 ? label : label.slice(0, 17) + "…") },
    tickLabels: { thin: true },
  },
};
const numeric = { scale: scaleLinear, nice: true, grid: true };
const accent = "var(--primary)";
const heightForRows = (count: number) => Math.max(220, count * 22);
const swatch = (color: string) => (
  <i className="chart-swatch" aria-hidden="true" style={{ backgroundColor: color }} />
);
const seriesColor = (index: number) => palette[index % palette.length]!;

function ChartTable({
  headers,
  rows,
}: {
  headers: readonly string[];
  rows: readonly (readonly (string | number)[])[];
}) {
  return (
    <details>
      <summary>Chart data</summary>
      <table className="chart-table">
        <thead>
          <tr>
            {headers.map((header, i) => (
              <th scope="col" key={i}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((value, j) => (
                <td key={j}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function PieChart({ data, title, orientation }: WorkProps<"PieChart">) {
  const slices = pie(data, { value: "value" });
  const definition = defineChart({
    marks: [
      polar({
        marks: [
          radialArc(slices, {
            key: "label",
            fill: (slice) => seriesColor(slice.index),
            stroke: "var(--panel)",
            strokeWidth: 1,
          }),
        ],
        scales: { angle: null, radius: null },
      }),
    ],
    scales: { x: null, y: null },
  });
  return (
    <div className={orientation === "horizontal" ? "chart-beside" : undefined}>
      <div>
        {data.some((row) => row.value > 0) ? (
          <Chart definition={definition} height={220} ariaLabel={title} />
        ) : (
          <p>All values are zero.</p>
        )}
      </div>
      <dl className="chart-values">
        {data.map(({ label, value }, i) => (
          <div key={label}>
            <dt>
              {swatch(seriesColor(i))}
              {label}
            </dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function BarChart({ title, data, orientation, stacked }: WorkProps<"BarChart">) {
  const series = [
    ...new Set(data.flatMap((row) => (row.series === undefined ? [] : [row.series]))),
  ];
  const segment = stacked
    ? ({ z: "series", color: "series", layout: stack({ order: series }) } as const)
    : { fill: accent };
  const color = { domain: series, range: series.map((_, i) => seriesColor(i)) };
  const horizontal = orientation === "horizontal";
  const plot = horizontal ? (
    <Chart
      ariaLabel={title}
      height={heightForRows(new Set(data.map((row) => row.label)).size)}
      definition={defineChart({
        marks: [barX(data, { x: "value", y: "label", ...segment })],
        scales: { x: numeric, y: category },
        color,
      })}
    />
  ) : (
    <Chart
      ariaLabel={title}
      height={220}
      definition={defineChart({
        marks: [barY(data, { x: "label", y: "value", ...segment })],
        scales: { x: category, y: numeric },
        color,
      })}
    />
  );
  return (
    <>
      {plot}
      {stacked && (
        <ul className="chart-legend">
          {series.map((name, i) => (
            <li key={name}>
              {swatch(seriesColor(i))}
              {name}
            </li>
          ))}
        </ul>
      )}
      <ChartTable
        headers={stacked ? ["Category", "Series", "Value"] : ["Category", "Value"]}
        rows={data.map((row) =>
          row.series === undefined ? [row.label, row.value] : [row.label, row.series, row.value],
        )}
      />
    </>
  );
}

function LineChart({ title, data }: WorkProps<"LineChart">) {
  const xy = { x: "label", y: "value" } as const;
  const definition = defineChart({
    marks: [lineY(data, { ...xy, stroke: accent }), dot(data, { ...xy, fill: accent, r: 3 })],
    scales: { x: category, y: numeric },
  });
  return (
    <>
      <Chart ariaLabel={title} height={220} definition={definition} />
      <ChartTable
        headers={["Category", "Value"]}
        rows={data.map((row) => [row.label, row.value])}
      />
    </>
  );
}

function Histogram({ title, data, xLabel }: WorkProps<"Histogram">) {
  const min = Math.min(...data),
    max = Math.max(...data);
  if (min === max) {
    const onlyBin = [{ label: String(min), count: data.length }];
    const definition = defineChart({
      marks: [barY(onlyBin, { x: "label", y: "count", fill: accent })],
      scales: {
        x: { ...category, axis: { label: xLabel } },
        y: { ...numeric, axis: { label: "Count" } },
      },
    });
    return (
      <>
        <Chart ariaLabel={title} height={240} definition={definition} />
        <ChartTable headers={[xLabel, "Count"]} rows={[[min, data.length]]} />
      </>
    );
  }
  // Keep the binning library's tick arithmetic finite for extreme exponents.
  const magnitude = Math.max(Math.abs(min), Math.abs(max));
  const unit = magnitude > 1e100 || magnitude < 1e-100 ? magnitude : 1;
  const bins = binX(data, {
    value: (value) => value / unit,
    ...(unit === 1 ? {} : { domain: [min / unit, max / unit] as const }),
  });
  const definition = defineChart({
    marks: [rect(bins, { x1: "x1", x2: "x2", y1: () => 0, y2: "value", inset: 0.5, fill: accent })],
    scales: {
      x: { scale: scaleLinear, axis: { label: unit === 1 ? xLabel : `${xLabel} (× ${unit})` } },
      y: { ...numeric, axis: { label: "Count" } },
    },
  });
  return (
    <>
      <Chart ariaLabel={title} height={240} definition={definition} />
      <ChartTable
        headers={[`From (${xLabel})`, "To", "Count"]}
        rows={bins.map((bin) => [bin.x1 * unit, bin.x2 * unit, bin.value])}
      />
    </>
  );
}

function ScatterPlot({ title, data, xLabel, yLabel }: WorkProps<"ScatterPlot">) {
  const definition = defineChart({
    marks: [
      dot(data, {
        x: "x",
        y: "y",
        key: (_, { index }) => index,
        fill: accent,
        fillOpacity: 0.8,
        r: 4,
      }),
    ],
    scales: {
      x: { ...numeric, axis: { label: xLabel } },
      y: { ...numeric, axis: { label: yLabel } },
    },
  });
  return (
    <>
      <Chart ariaLabel={title} height={260} definition={definition} />
      <ChartTable
        headers={["Observation", xLabel, yLabel]}
        rows={data.map((row, i) => [row.label ?? i + 1, row.x, row.y])}
      />
    </>
  );
}

function Heatmap({ title, data }: WorkProps<"Heatmap">) {
  const values = [...new Set(data.map((row) => row.value))].sort((a, b) => a - b);
  const min = values[0]!,
    max = values[values.length - 1]!;
  const shade = (value: number) => {
    const span = max - min;
    const fraction =
      max === min
        ? 0.5
        : Number.isFinite(span)
          ? (value - min) / span
          : (value / 2 - min / 2) / (max / 2 - min / 2);
    return `color-mix(in srgb, var(--primary) ${20 + fraction * 80}%, var(--panel))`;
  };
  const definition = defineChart({
    marks: [cell(data, { x: "x", y: "y", color: "value", inset: 0 })],
    scales: { x: category, y: category },
    color: { domain: values, range: values.map(shade) },
  });
  return (
    <>
      <Chart
        ariaLabel={title}
        height={heightForRows(new Set(data.map((row) => row.y)).size)}
        definition={definition}
      />
      <div className="chart-legend" aria-label="Color scale">
        {swatch(shade(min))}
        {min}
        {max !== min && (
          <>
            {" "}
            to {swatch(shade(max))}
            {max}
          </>
        )}
      </div>
      <ChartTable
        headers={["Column", "Row", "Value"]}
        rows={data.map((row) => [row.x, row.y, row.value])}
      />
    </>
  );
}

function GanttChart({ title, data }: WorkProps<"GanttChart">) {
  const tasks = data.map((row) => ({ ...row, start: new Date(row.start), end: new Date(row.end) }));
  const definition = defineChart({
    marks: [
      rect(tasks, { x1: "start", x2: "end", y: "label", key: "label", fill: accent, inset: 0 }),
    ],
    scales: {
      x: { scale: scaleUtc, axis: { label: "Time (UTC)", tickLabels: { thin: true } } },
      y: category,
    },
  });
  return (
    <>
      <Chart ariaLabel={title} height={heightForRows(data.length)} definition={definition} />
      <ChartTable
        headers={["Task", "Start (UTC)", "End (UTC)"]}
        rows={data.map((row) => [row.label, row.start, row.end])}
      />
    </>
  );
}

function plotChart(input: ChartInput): ReactNode {
  switch (input.name) {
    case "PieChart":
      return <PieChart {...input.props} />;
    case "BarChart":
      return <BarChart {...input.props} />;
    case "LineChart":
      return <LineChart {...input.props} />;
    case "Histogram":
      return <Histogram {...input.props} />;
    case "ScatterPlot":
      return <ScatterPlot {...input.props} />;
    case "Heatmap":
      return <Heatmap {...input.props} />;
    case "GanttChart":
      return <GanttChart {...input.props} />;
  }
}

export default function CatalogChart(input: ChartInput) {
  return (
    <figure className="catalog-chart" data-chart={input.name}>
      <figcaption>{input.props.title}</figcaption>
      {plotChart(input)}
    </figure>
  );
}
