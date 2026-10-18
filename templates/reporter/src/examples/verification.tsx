import { FeedbackForm } from "../components/feedback.tsx";
import {
  CodePanel,
  FindingList,
  ReportHeader,
  Section,
  SectionNavigation,
  StatusTimeline,
} from "../components/report.tsx";

/** A manually authored example, deliberately separate from retained controller evidence. */
export default function VerificationExample() {
  return (
    <main>
      <ReportHeader
        eyebrow="AbraCode / Manual example / Verification"
        title="Make the evidence visible."
        summary="Compose a verification report with ordinary TSX. This illustrative example has no attached controller evidence; its checks are not reported as passed."
        labels={["Illustrative example", "Presentation only", "No live monitoring"]}
        observedAt="2026-10-18T00:00:00.000Z"
      />
      <SectionNavigation
        sections={[
          { id: "verification-evidence", title: "Evidence" },
          { id: "verification-code", title: "Code and diff" },
          { id: "verification-status", title: "Snapshot" },
          { id: "verification-feedback", title: "Feedback" },
        ]}
      />
      <Section id="verification-evidence" title="Evidence and limitations">
        <FindingList
          label="Filter verification findings"
          findings={[
            {
              title: "Verification evidence is unavailable",
              category: "Limitation",
              summary: "Attach retained check results before claiming success.",
              evidence:
                "This authored example is a layout demonstration. It has no commit, test receipt or source reference. Missing evidence stays unavailable.",
            },
          ]}
        />
      </Section>
      <Section id="verification-code" title="Code and diff excerpts">
        <CodePanel
          title="Illustrative policy pseudocode"
          provenance="Author-written illustration; not a source excerpt or execution receipt."
          text={
            "if (nativeTurnComplete && requiredReplyReceived) {\n  requestControllerCheckpoint();\n}"
          }
        />
        <CodePanel
          title="Illustrative policy diff"
          kind="diff"
          provenance="Author-written comparison; no repository changes are asserted."
          text={"- nativeTurnComplete\n+ nativeTurnComplete && requiredReplyReceived"}
        />
      </Section>
      <Section id="verification-status" title="Verification snapshot">
        <StatusTimeline
          observedAt="2026-10-18T00:00:00.000Z"
          provenance="Illustrative status only. No native lifecycle events or successful checks were supplied."
          events={[
            {
              label: "Evidence collection",
              status: "Unavailable",
              detail: "Source references and controller receipts have not been attached.",
            },
            {
              label: "Verification",
              status: "Not run",
              detail: "The report must not infer success from missing data.",
            },
          ]}
        />
      </Section>
      <Section id="verification-feedback" title="Local review feedback">
        <FeedbackForm
          sections={[
            { id: "verification-evidence", title: "Evidence" },
            { id: "verification-code", title: "Code and diff" },
            { id: "verification-status", title: "Snapshot" },
          ]}
        />
      </Section>
      <footer>Prepared with the AbraCode report template · Presentation only</footer>
    </main>
  );
}
