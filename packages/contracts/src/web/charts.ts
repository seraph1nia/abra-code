import { Schema } from "effect";
import { Timestamp } from "../identities.ts";

const label = Schema.NonEmptyString.check(Schema.isMaxLength(120));
const title = Schema.NonEmptyString.check(Schema.isMaxLength(256));
const orientation = Schema.optionalKey(Schema.Literals(["vertical", "horizontal"]));
const rows = <S extends Schema.Constraint>(row: S) =>
  Schema.Array(row).check(Schema.isMinLength(1), Schema.isMaxLength(100));
const point = { label, value: Schema.Finite };
const chartFields = { title, data: rows(Schema.Struct(point)) };

function chart<
  const N extends string,
  const F extends Readonly<Record<string, Schema.ConstraintDecoder<unknown>>>,
>(name: N, fields: F, description: string) {
  const props = Schema.Struct(fields);
  const decode = Schema.decodeUnknownSync(props);
  return { name, props, description, decode: (input: unknown) => ({ name, props: decode(input) }) };
}

export const chartComponents = {
  LineChart: chart(
    "LineChart",
    chartFields,
    "Line graph of ordered, uniquely labeled numeric observations.",
  ),
  BarChart: chart(
    "BarChart",
    {
      title,
      data: rows(Schema.Struct({ ...point, series: Schema.optionalKey(label) })),
      orientation,
      stacked: Schema.optionalKey(Schema.Boolean),
    },
    "Vertical (default) or horizontal bars. For stacked bars set stacked=true and provide one value for each unique label and series pair.",
  ),
  PieChart: chart(
    "PieChart",
    {
      title,
      data: rows(
        Schema.Struct({ label, value: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)) }),
      ),
      orientation,
    },
    "Show nonnegative shares with unique labels. The legend sits below the pie (vertical, default) or beside it (horizontal).",
  ),
  Histogram: chart(
    "Histogram",
    { title, data: rows(Schema.Finite), xLabel: label },
    "Distribution of raw numeric observations in automatically sized bins. Include units in xLabel.",
  ),
  ScatterPlot: chart(
    "ScatterPlot",
    {
      title,
      data: rows(
        Schema.Struct({ x: Schema.Finite, y: Schema.Finite, label: Schema.optionalKey(label) }),
      ),
      xLabel: label,
      yLabel: label,
    },
    "Plot paired numeric observations. Name both axes with units. Each point may have an identifying label.",
  ),
  Heatmap: chart(
    "Heatmap",
    { title, data: rows(Schema.Struct({ x: label, y: label, value: Schema.Finite })) },
    "Color matrix of numeric values by column x and row y. Each x/y pair occurs once. Omitted cells have no observation.",
  ),
  GanttChart: chart(
    "GanttChart",
    { title, data: rows(Schema.Struct({ label, start: Timestamp, end: Timestamp })) },
    "One time interval per uniquely labeled task. Supply UTC timestamps with end strictly after start.",
  ),
};
export type ChartComponentName = keyof typeof chartComponents;
export type ChartInput = ReturnType<(typeof chartComponents)[ChartComponentName]["decode"]>;
export function isChartComponent(name: unknown): name is ChartComponentName {
  return typeof name === "string" && Object.hasOwn(chartComponents, name);
}
export function validateChart(input: ChartInput) {
  let keys: readonly string[];
  switch (input.name) {
    case "BarChart": {
      const { data, stacked = false } = input.props;
      if (data.some((row) => (row.series !== undefined) !== stacked))
        throw new Error(
          "Provide a series on every stacked bar segment and omit it on ordinary bars",
        );
      keys = data.map((row) => JSON.stringify([row.label, row.series]));
      break;
    }
    case "Heatmap":
      keys = input.props.data.map((row) => JSON.stringify([row.x, row.y]));
      break;
    case "GanttChart":
      if (input.props.data.some((row) => Date.parse(row.end) <= Date.parse(row.start)))
        throw new Error("Gantt end must follow start");
      keys = input.props.data.map((row) => row.label);
      break;
    case "LineChart":
    case "PieChart":
      keys = input.props.data.map((row) => row.label);
      break;
    case "Histogram":
    case "ScatterPlot":
      return;
  }
  if (new Set(keys).size !== keys.length) throw new Error(`Repeated category in ${input.name}`);
}
