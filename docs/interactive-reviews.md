# Interactive plan and report reviews

Abra can publish a review beside an exact plan, saved report or generated view.
The app renders single-choice questions, multiple-choice checkboxes, visual design
cards and comment fields. Selecting a preview chooses that design; **Enlarge**
opens a keyboard-dismissible preview. **Send feedback to Abra** submits the
choices as a revision request. It does not approve a plan, merge or implementation.

The same review appears in its producing conversation and in the matching Plan
or Reports inspector. Open **Give feedback** to load an inspector review. Drafts
are shared between mounted presentations and restored on reload when browser
storage is available. Each revision has its own draft. A superseded review or
changed plan preserves the draft and requests an updated review.

**Received by Abra** means the input was admitted. A revision link appears only
after Abra publishes a follow-up review with the response's `request_id` as
`responds_to`. A report remains immutable: a revision is a follow-up publication,
not a rewrite of the evidence. Existing controller checkpoints still apply.

## Authoring

Only central Abra can call `abra_review_ui`. First obtain the exact source:

```json
{
  "action": "source",
  "source": { "kind": "plan", "issue_id": "abra-example", "path": "proposal.md" }
}
```

The response supplies the source hash and execution generation. Use the returned
source object unchanged in a publication:

```json
{
  "action": "publish",
  "review": {
    "review_id": "release-options",
    "title": "Choose the first release",
    "source": {
      "kind": "plan",
      "issue_id": "abra-example",
      "path": "proposal.md",
      "generation": 0,
      "hash": "<hash returned by source>"
    },
    "fields": [
      {
        "component": "MultiSelect",
        "id": "features",
        "label": "Include these features",
        "options": [
          { "value": "email", "label": "Email login" },
          { "value": "reset", "label": "Password reset" }
        ]
      },
      {
        "component": "DesignChoiceGroup",
        "id": "design",
        "label": "Choose a visual direction",
        "required": true,
        "options": [
          { "value": "a", "label": "Design A", "preview": "design-a" },
          { "value": "b", "label": "Design B", "preview": "design-b" }
        ]
      },
      { "component": "CommentField", "id": "comments", "label": "Comments" }
    ]
  },
  "previews": [
    { "id": "design-a", "path": "designs/a.png" },
    { "id": "design-b", "path": "designs/b.png" }
  ]
}
```

`SingleSelect` uses the same option shape as `MultiSelect`. Field IDs use letters,
digits and underscores and start with a letter; `root` and
`review_heading` are reserved. There are at most 20 fields, 32 options per ordinary
choice group, 16 design options and 4096 characters per comment. Definitions are
bounded to 64 KiB and submitted answers to 16 KiB. The native admission envelope
must also fit its existing 32,768-character limit.

Reuse `review_id` to publish a new revision. An identical native call retry returns
its original publication; changed input needs another call. Use `action: "read"`
with `review_id` and `revision` to inspect retained definitions and captured source
excerpts. Oversized surface/report excerpts are explicitly marked; exact source
identities continue to address the complete retained artifact.

Other source kinds are `{kind:"surface",surface_id,revision,hash}` and
`{kind:"report",issue_id,request_id,hash}`. Source discovery computes a surface's
exact hash; a report uses its saved document receipt hash. Plan hashes use the
canonical presentation hash of the exact returned planning text. Images must be
regular non-symlink PNG, JPEG or WebP files inside the source-owned worktree.
Surface images require a single captured task with an owned worktree. Images are
limited to 2 MiB each and 8 MiB per review, then retained by digest independently
of worktree retirement. Missing/corrupt images produce a local diagnostic.

## Recovery and compatibility

The review owner keeps the last committed revision readable while it prepares
a new revision. The new revision becomes visible in catalog reads, exact
revision and image reads, and transcript attachments after its immutable
record, images and message association exist and the head is committed.
An exact selection of a reserved revision reports that publication is pending.

If publication is interrupted, startup or retry reconciles the same native
call and revision. A supported legacy pending head keeps its predecessor
visible when the predecessor's record and association prove publication.
Unresolved evidence stays retained and carries a review-specific recovery
diagnostic. Other reviews remain readable. Publication recovery preserves
the existing response reservation, admission receipt and browser draft
identities.

The native owner retains immutable review definitions, input hashes, source identity, images,
message associations and response reservations. The app retains a response ID
before sending. **Reconcile response** reuses that input; lost or uncertain native
results never automatically allocate a replacement message. An exact receipt read
checks that the admission belongs to this review response. Existing responses
remain reconcilable after the source changes.

The review catalog and native storage namespace are separate from saved evidence.
Offline HTML retains its existing local feedback export and has no new review
controls or network requirement. Older report and surface bytes are not migrated.
Install matching app/runtime versions when using the new review attachment type.
