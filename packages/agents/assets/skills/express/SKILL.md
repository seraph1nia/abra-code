---
name: express
description: Compose, check, revise and publish a generated workspace view with abra_render_ui in the Supervisor conversation.
---

Choose a stable `surface_id`. Put the complete Express body in `source`, with one `root` assignment. Use arrays for fixed children and List templates for repeated data. Nest components directly or assign reusable names to individual children. Place each child once. Express assigns inline component IDs. Use named components with short identifiers for deep layouts.

Use observed issue IDs and owned resource targets. Omitting `issueIds` selects all work. Choose `mode="live"` to follow work or `mode="snapshot"` to capture it when the view is published. Use literal Mermaid source. Use ResourceLink for workspace navigation. Initialize surface-local state with `$/title = "Overview"` before the root assignment and bind controls or Text with `$/title`. One call publishes one complete layout. Input edits stay local to the viewer. Button events prepare a chat draft for the user to send. Use openUrl for a user-activated HTTP(S) link and data URLs for media that must travel with a saved report.

## Compare two work items

Substitute the selected issue IDs before calling the tool.

```express
root = Row([
  WorkTable(issueIds=["abra-1"], mode="live"),
  WorkTable(issueIds=["abra-2"], mode="live")
])
```

## Capture a status snapshot

```express
root = Column([
  Text("Status at publication"),
  StatusSummary(mode="snapshot")
])
```

Omit `validate_only` to publish. The returned revision identifies the view attached to this message. For a draft, set `validate_only=true`. A successful check returns the surface ID and `validated=true`. Correct the indicated expression, limit or resource reference after a rejection. A failed diagram service check can be retried when verification is available.

## Chart observed values

Supply a title and 1–100 literal observations. For LineChart, BarChart and PieChart, use `{label, value}` rows with unique labels. LineChart follows input order. BarChart defaults to vertical bars. PieChart takes nonnegative values and places its legend beside the pie with `orientation="horizontal"`.

For stacked bars, set `stacked=true` and supply a series on every row. Each label/series pair appears once. Both orientations support stacking. For a histogram, supply raw numbers and name the unit on the x-axis. For a scatter plot, label both numeric axes. A heatmap takes one value per column/row pair. A Gantt chart takes one interval per task with UTC timestamps and an end after its start.

```express
root = Column([
  BarChart("Tickets by repository", [{label:"Web", series:"Open", value:4}, {label:"Web", series:"Blocked", value:2}], orientation="horizontal", stacked=true),
  Histogram("Cycle times", [2, 3, 3, 7, 12], xLabel="Hours"),
  ScatterPlot("Review time", [{x:20, y:3, label:"PR 42"}, {x:80, y:7, label:"PR 43"}], xLabel="Lines changed", yLabel="Hours"),
  Heatmap("Failures", [{x:"Mon", y:"Web", value:0}, {x:"Tue", y:"Web", value:3}]),
  GanttChart("Task intervals", [{label:"Build", start:"2026-11-21T09:00:00Z", end:"2026-11-21T10:00:00Z"}])
])
```

## Present literal content

```express
root = Card(Column([
  KeyValueList([{label:"Branch", value:"main"}]),
  Table("Options", ["Approach", "Effort"], [["Reuse", "Small"]]),
  Disclosure("Implementation", CodeBlock("return value", language="Python"))
]))
```

## Work catalog signatures

Optional arguments carry a question mark. Use keywords to skip earlier optional arguments.

```text
• AudioPlayer(url, description?, weight? (static))
• BarChart(title (static), data (static), orientation? (static), stacked? (static))
• Button(child (static), variant? (static), action (static), weight? (static), checks? (static))
• Card(child (static), weight? (static))
• CheckBox(label, value, weight? (static), checks? (static))
• ChoicePicker(label?, variant? (static), options (static), value, displayStyle? (static), filterable? (static), weight? (static), checks? (static))
• CodeBlock(code (static), language? (static))
• Column(children, justify? (static), align? (static), weight? (static))
• DateTimeInput(value, enableDate? (static), enableTime? (static), min?, max?, label?, weight? (static), checks? (static))
• DecisionSummary(issueIds? (static), mode? (static))
• DependencyGraph(issueIds? (static), mode? (static))
• Disclosure(label (static), child (static))
• Divider(axis? (static), weight? (static))
• GanttChart(title (static), data (static))
• Heatmap(title (static), data (static))
• Histogram(title (static), data (static), xLabel (static))
• Icon(name, weight? (static))
• Image(url, description?, fit? (static), variant? (static), weight? (static))
• Kanban(issueIds? (static), mode? (static))
• KeyValueList(entries (static))
• LineChart(title (static), data (static))
• List(children, direction? (static), align? (static), weight? (static))
• Mermaid(title (static), source (static), description? (static))
• Modal(trigger (static), content (static), weight? (static))
• PieChart(title (static), data (static), orientation? (static))
• ReportEvidence(section (static))
• ReportLink(issueId (static))
• ResourceLink(label (static), target (static))
• Row(children, justify? (static), align? (static), weight? (static))
• ScatterPlot(title (static), data (static), xLabel (static), yLabel (static))
• Slider(label?, min? (static), max (static), value, steps? (static), weight? (static), checks? (static))
• StatusSummary(issueIds? (static), mode? (static))
• Table(caption (static), columns (static), rows (static))
• Tabs(tabs (static), weight? (static))
• Text(text, variant? (static), weight? (static))
• TextField(label, value?, placeholder?, variant? (static), weight? (static), checks? (static))
• Timeline(issueIds? (static), mode? (static))
• Video(url, posterUrl?, weight? (static))
• WorkTable(issueIds? (static), mode? (static))
• and(values)
• email(value)
• formatCurrency(value, currency, decimals?, grouping?)
• formatDate(value, format)
• formatNumber(value, decimals?, grouping?)
• formatString(value)
• length(value, min?, max?)
• not(value)
• numeric(value, min?, max?)
• openUrl(url)
• or(values)
• pluralize(value, zero?, one?, two?, few?, many?, other)
• regex(value, pattern)
• required(value)
```
