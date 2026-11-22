# Proposal

## Why

After Abra explains a blocked delivery, a user can reasonably ask “Can you show me why?” Today the Supervisor's `abra-express` skill explains how to publish a view, but gives little guidance on recognizing that follow-up or choosing a view that reveals the cause.

## What Changes

- Describe the skill in the terms users use to request a visual explanation, a comparison, or a dashboard they can keep open.
- Add a short “Choose the view” section before the Express syntax. Start from the question and the available evidence. Show the observed blocker, the consequential differences between two plans, or the live state of the specified work.
- Carry the subject through conversational follow-ups. When a user asks to revise a dashboard, publish the revision under its existing surface ID. Keep the accompanying chat takeaway short.

## Capabilities

### New Capabilities

### Modified Capabilities

- `workspace-view-authoring` gains requirements for choosing and revising a visual response in conversation. The implemented change `author-workspace-views-with-express` introduces this capability and still holds its initial delta. This proposal adds distinct requirements under the same path.

## Impact

The implementation belongs in `packages/agents/assets/skills/express/SKILL.md`. The Supervisor already discovers its frontmatter description through the skill inventory and publishes complete revisions with `abra_render_ui`. Existing catalog components cover the proposed views.

## Scope and Choices

Use original examples drawn from AbraCode work. A dependency reference alone does not establish the reason delivery is blocked. Choose a widget after identifying the cause from observations, and state what is unknown if the evidence is incomplete. Ordinary requests for a text answer continue through chat.
