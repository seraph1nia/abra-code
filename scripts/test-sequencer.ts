import { BaseSequencer, type TestSpecification } from "vite-plus/test/node";

/** Backfill long CLI/browser waits with other projects instead of exhausting
 * projects alphabetically. Keep Vitest's sharding and explicit group ordering. */
export default class Sequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]) {
    const ordered = await super.sort(files);
    return ordered.sort((a, b) => {
      const group = a.project.config.sequence.groupOrder - b.project.config.sequence.groupOrder;
      if (group) return group;
      const first = this.ctx.cache.getTestSpecificationResult(a);
      const second = this.ctx.cache.getTestSpecificationResult(b);
      return (second?.duration ?? 10_000) - (first?.duration ?? 10_000);
    });
  }
}
