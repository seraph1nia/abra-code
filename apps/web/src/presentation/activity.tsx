import { useSearch, useNavigate } from "@tanstack/react-router";
import type { WebWorkItem } from "@abracode/contracts/web/wire";
import { activitySections, searchForResource } from "../navigation.ts";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@abracode/presentation/ui/tabs";
import { SessionsPanel } from "./sessions.tsx";
import { CommunicationPanel } from "./obligations.tsx";
import { ReviewsPanel } from "./reviews.tsx";
import { LeadsPanel } from "./leads.tsx";
import type { Inspect } from "@abracode/presentation/cards";
const labels = {
  sessions: "Sessions",
  communication: "Communication",
  checks: "Reviews & checks",
  leads: "Leads & proposals",
};
export function ActivityPanel({ work, inspect }: { work: WebWorkItem; inspect: Inspect }) {
  const route = useSearch({ from: "/" }),
    navigate = useNavigate({ from: "/" });
  const section = route.activity ?? "sessions";
  return (
    <Tabs
      value={section}
      onValueChange={(value) => {
        const activity = activitySections.find((section) => section === value);
        if (activity)
          void navigate({
            search: searchForResource({
              action: "open_task",
              issue_id: work.issue_id,
              section: "activity",
              activity,
            }),
          });
      }}
    >
      <TabsList
        variant="line"
        className="tabs w-full overflow-x-auto justify-start"
        aria-label="Activity evidence"
      >
        {activitySections.map((section) => (
          <TabsTrigger key={section} value={section}>
            {labels[section]}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={section} key={section}>
        {section === "sessions" ? (
          <SessionsPanel work={work} inspect={inspect} />
        ) : section === "communication" ? (
          <CommunicationPanel issue={work.issue_id} inspect={inspect} />
        ) : section === "checks" ? (
          <ReviewsPanel issue={work.issue_id} />
        ) : (
          <LeadsPanel issue={work.issue_id} inspect={inspect} />
        )}
      </TabsContent>
    </Tabs>
  );
}
