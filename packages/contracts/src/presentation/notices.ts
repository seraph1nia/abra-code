/** Projection shared by the portable build and its verified source identity. */
export type NoticeInventory = {
  readonly packages: readonly {
    readonly id: string;
    readonly license: string;
    readonly author: unknown;
    readonly uses: readonly string[];
    readonly evidence: readonly { readonly sha256: string }[];
  }[];
};
export const reportNoticeInputs = (inventory: NoticeInventory) =>
  inventory.packages
    .filter((item) => item.uses.includes("report-artifact"))
    .map((item) => ({
      id: item.id,
      license: item.license,
      author: item.author,
      evidence: item.evidence.map((value) => value.sha256),
    }));
