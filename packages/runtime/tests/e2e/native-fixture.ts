import { test } from "vite-plus/test";
import { startNativeHarness, type NativeOptions } from "./native-harness.ts";
import { companionJourneys } from "./journeys/companions.ts";
import { runSelectedJourney } from "./journeys/selected.ts";
import { runResearchContracts } from "./journeys/research-contracts.ts";
import { runFinishing } from "./journeys/finishing.ts";
import { defaultDelivery } from "./journeys/default-delivery.ts";
export function nativeTest(name: string, options?: NativeOptions) {
  test(name, { timeout: options?.timeout ?? 600000 }, async (t) => {
    const h = await startNativeHarness(t, options);
    const companions = companionJourneys(h);
    if (await runSelectedJourney(h, companions)) return;
    const { journey, projects, invoke } = h;
    const { controls } = h.mock;
    if (journey === "research") {
      controls.failFirstExplore = false;
      await invoke("abra_project_onboard", {
        id: "worker",
        path: projects[2],
        action: "register",
        delivery: "branch",
        verification: [
          [
            process.execPath,
            "-e",
            'if(require("fs").readFileSync("source.txt","utf8")!=="sample\\n")process.exit(1)',
          ],
        ],
      });
      await runResearchContracts(h, companions);
      return;
    }
    if (journey === "finishing") {
      await runFinishing(h);
      return;
    }
    await defaultDelivery(h, companions);
  });
}
