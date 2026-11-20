# Proposal

## Why

Abra already has one conversation, a review canvas, and a shared presentation catalog. Two headers, expanded attention forms, and long tool outputs take space from the answer, while a link from a finding can leave the reader searching a whole activity section for the evidence they clicked.

## What Changes

- **1. Simplify the conversation shell.** Put Work, Abra, connection state, pending attention, and an in-place appearance menu in one header. Show the next human decision on request, keep the device recap separate, and preserve unfinished answers. Give conversation prose a comfortable measure, short user messages a fitted bubble, and wide evidence the space it needs. Use the existing green theme and shared controls.
- **2. Finish the canvas interaction.** Open the selected finding, file, plan passage, or report first. Keep the task title and other sections in a compact switcher. Follow a finding's evidenced file reference into the diff and attach selected lines to the main composer. Use the same selection label and Ask Abra action for plan passages and image regions.
- **3. Bring rich results into that interaction.** Show the takeaway at the producing tool call and give a substantial generated view one action to open its exact layout revision. Lead verification with the check outcome, independent review status, and next available action. Offer one canvas refresh and a local retry where a section fails.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `application-branding` gains a compact, readable workspace shell with in-place appearance controls.
- `work-visibility` gains compact human attention, direct evidence navigation, consistent selection actions, inline result summaries, and scoped canvas refresh.

## Impact

The changes touch the React workspace, TanStack Router search state, shared presentation components and styles, typed web resource contracts, scoped runtime readers, and browser verification. The completed chat-workspace and contextual-steering changes supply the existing interaction contracts. Their inline presentation, retained selection, and native approval behavior carry forward.

## Scope and Choices

Use the existing headless CopilotKit tool renderer for observations and the existing A2UI catalog for generated layouts. Routine controls and verification use shared React components. Opening the canvas is a read. Only an explicit Ask Abra action attaches a source, and only Send submits the draft. Native forms retain their binding and controller checks.

The router identifies what is open, the session draft identifies what will be sent, and a saved report identifies frozen content. A generated layout may span several tasks. Its canvas target follows the owning Abra session, surface ID, and revision. Opening an earlier live layout can still show current data, clearly labeled. Saved reports continue to open by issue, request, and content hash.
