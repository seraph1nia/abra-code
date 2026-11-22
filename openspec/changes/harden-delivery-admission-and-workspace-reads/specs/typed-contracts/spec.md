# Spec Delta

## ADDED Requirements

### Requirement: Prepare diagrams from compact exact source selections

An authorized read of a diagram-bearing surface revision SHALL supply its content digest for preparation. The browser’s preparation identity SHALL depend on bounded source identifiers, revision and digest, independent of the size of the surface. The preparation owner SHALL verify the exact retained source before returning assets.

#### Scenario: Open a surface written before digests were exposed

- **WHEN** the workspace opens a historical or current committed surface that contains diagrams
- **THEN** the read supplies the digest of that revision, allowing preparation without encoding its body in a request or cache key and without rewriting the stored publication.
- **AND** an unavailable revision or incorrect digest cannot return assets from another source.

#### Scenario: Concurrent readers request the same diagram revision

- **WHEN** multiple readers in the same session request preparation for the same exact source
- **THEN** they can share the request while a reader switching revisions receives only the newly selected assets.
- **AND** unmounting the last subscriber releases the pending read, and frozen reports with prepared assets render without a live request.
