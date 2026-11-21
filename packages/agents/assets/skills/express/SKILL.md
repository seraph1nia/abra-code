---
name: express
description: Compose, check, revise and publish a generated workspace view with abra_render_ui in the Supervisor conversation.
---

Choose a stable `surface_id`. Put the complete Express body in `source`, with one `root` assignment. Use literal text and arrays of children. Nest components directly or assign reusable names to individual children. Place each child once. Express assigns inline component IDs. Use named components with short identifiers for deep layouts.

Use observed issue IDs and owned resource targets. Omitting `issueIds` selects all work. Choose `mode="live"` to follow work or `mode="snapshot"` to capture it when the view is published. Use literal Mermaid source. Links use the catalog’s typed targets. The host accepts one static layout per call. Data assignments, dynamic text, action callbacks, surface updates and deletions fall outside this contract.

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

## Work catalog signatures

Optional arguments carry a question mark. Use keywords to skip earlier optional arguments.

```text
• Column(children, justify? (static), align? (static), weight? (static))
• DecisionSummary(issueIds? (static), mode? (static))
• DependencyGraph(issueIds? (static), mode? (static))
• Kanban(issueIds? (static), mode? (static))
• Mermaid(title (static), source (static), description? (static))
• ReportEvidence(section (static))
• ReportLink(issueId (static))
• ResourceLink(label (static), target (static))
• Row(children, justify? (static), align? (static), weight? (static))
• StatusSummary(issueIds? (static), mode? (static))
• Text(text, variant? (static), weight? (static))
• Timeline(issueIds? (static), mode? (static))
• WorkTable(issueIds? (static), mode? (static))
```
