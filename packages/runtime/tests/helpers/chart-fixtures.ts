export const analysisCharts = {
  BarChart: {
    id: "segments",
    component: "BarChart",
    title: "Backlog",
    stacked: true,
    data: [
      { label: "Web", series: "Open", value: 2 },
      { label: "Web", series: "Blocked", value: 1 },
      { label: "API", series: "Open", value: 4 },
    ],
  },
  Histogram: {
    id: "duration",
    component: "Histogram",
    title: "Cycle times",
    xLabel: "Hours",
    data: [1, 2, 2, 4, 8],
  },
  ScatterPlot: {
    id: "reviews",
    component: "ScatterPlot",
    title: "Review time",
    xLabel: "Lines changed",
    yLabel: "Hours",
    data: [
      { x: 10, y: 2, label: "PR 1" },
      { x: 30, y: 1, label: "PR 2" },
    ],
  },
  Heatmap: {
    id: "matrix",
    component: "Heatmap",
    title: "Failures",
    data: [
      { x: "Mon", y: "Web", value: 0 },
      { x: "Tue", y: "Web", value: 4 },
      { x: "Tue", y: "API", value: 2 },
    ],
  },
  GanttChart: {
    id: "tasks",
    component: "GanttChart",
    title: "Task intervals",
    data: [
      { label: "Web", start: "2026-11-21T09:00:00Z", end: "2026-11-21T11:00:00Z" },
      { label: "API", start: "2026-11-21T10:00:00Z", end: "2026-11-21T12:00:00Z" },
    ],
  },
};
