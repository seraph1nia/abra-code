# Spec Delta

## ADDED Requirements

### Requirement: Review saved reports through a live adjunct

The app SHALL present published interactive reviews beside their exact saved report. Review definitions, drafts, responses and previews SHALL remain independent of canonical report bytes. Offline HTML exports SHALL retain their existing local interactions without the live review controls or new network requirements.

#### Scenario: Submit feedback on a saved report

- **WHEN** the reader submits an in-app review of a saved report
- **THEN** Abra receives the exact report reference and choices while its canonical JSON and offline export remain unchanged
