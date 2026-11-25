import { RunCommand, composerCommands } from "./workspace-commands.ts";
import { useTheme } from "./theme.tsx";
import { NativeSelect } from "@abracode/presentation/ui/native-select";
import { Button } from "@abracode/presentation/ui/button";
import { SectionCard, StatusBadge } from "@abracode/presentation/cockpit";
import { ArrowLeft, ArrowUpRight } from "@abracode/presentation/icons";
import { SearchTrigger } from "./search-trigger.tsx";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useState, useLayoutEffect, useContext } from "react";
import type { AgentDefinitionView } from "@abracode/contracts/web/agent-settings";
import { agentsQuery, repositoriesQuery } from "./data.ts";
import { RequestState } from "./request-state.tsx";
import { Markdown } from "./markdown.tsx";

function Names({ values, empty = "None declared" }: { values: readonly string[]; empty?: string }) {
  return values.length ? (
    <ul className="agent-names">
      {values.map((value, index) => (
        <li key={`${index}/${value}`}>
          <code>{value}</code>
        </li>
      ))}
    </ul>
  ) : (
    <p className="muted">{empty}</p>
  );
}

function AgentDetails({ agent }: { agent: AgentDefinitionView }) {
  const hash = useRouterState({ select: (state) => state.location.hash });
  const [expanded, setExpanded] = useState(hash === "agent-" + agent.id);
  useLayoutEffect(() => {
    if (hash !== "agent-" + agent.id) return;
    const element = document.getElementById(hash) as HTMLDetailsElement | null;
    if (!element) return;
    element.open = true;
    element.querySelector("summary")?.focus({ preventScroll: true });
    element.scrollIntoView({ block: "nearest" });
  }, [hash, agent.id]);
  return (
    <details
      id={"agent-" + agent.id}
      open={expanded}
      className="agent-definition"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary aria-label={`Inspect ${agent.id}`}>
        <span className="agent-summary">
          <span className="agent-title">
            <strong>{agent.id}</strong>
            <StatusBadge tone={agent.mode === "primary" ? "success" : "neutral"}>
              {agent.mode}
            </StatusBadge>
          </span>
          <span className="muted">{agent.description}</span>
        </span>
      </summary>
      <div className="agent-details">
        <dl className="agent-metadata">
          <div>
            <dt>Revision</dt>
            <dd>
              <code>{agent.revision}</code>
            </dd>
          </div>
          <div>
            <dt>Roles</dt>
            <dd>{agent.roles.join(", ") || "None declared"}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>
              {agent.model
                ? `${agent.model.providerID}/${agent.model.id}${agent.model.variant ? ` · ${agent.model.variant}` : ""}`
                : "Uses configured model"}
            </dd>
          </div>
          <div>
            <dt>Assignment context</dt>
            <dd>
              {agent.dynamicContext
                ? "Provided dynamically for each assignment"
                : "No dynamic context provider"}
            </dd>
          </div>
        </dl>
        <section>
          <h3>Tools</h3>
          {agent.tools ? (
            <Names values={agent.tools} />
          ) : (
            <p className="muted">Uses role defaults</p>
          )}
          {agent.customTools.length > 0 && (
            <>
              <h4>Custom tools</h4>
              <ul className="agent-names">
                {agent.customTools.map((tool) => (
                  <li key={tool.id}>
                    <code>{tool.id}</code> <span className="muted">revision {tool.revision}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section>
          <h3>Skills</h3>
          {agent.skills.length ? (
            <ul className="agent-names">
              {agent.skills.map((skill) => (
                <li key={skill.name}>
                  <code>{skill.name}</code>
                  {skill.preload && <span className="muted"> · preloaded</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">None declared</p>
          )}
        </section>
        {(agent.requiredSkills.length > 0 || agent.requiredTools.length > 0) && (
          <section>
            <h3>Required capabilities</h3>
            {agent.requiredSkills.length > 0 && (
              <>
                <h4>Skills</h4>
                <Names values={agent.requiredSkills} />
              </>
            )}
            {agent.requiredTools.length > 0 && (
              <>
                <h4>Tools · one of each group</h4>
                <Names values={agent.requiredTools.map((group) => group.join(" or "))} />
              </>
            )}
          </section>
        )}
        {agent.deny.length > 0 && (
          <section>
            <h3>Additional denials</h3>
            <Names values={agent.deny} />
          </section>
        )}
        {expanded && (
          <section className="agent-instructions">
            <h3>Instructions</h3>
            {agent.instructions.length ? (
              agent.instructions.map((source, index) => (
                <div key={index} className="agent-instruction">
                  {source.kind === "file" ? (
                    <>
                      <span className="muted">Source file</span>
                      <code>{source.path}</code>
                    </>
                  ) : (
                    <span className="muted">Inline instructions</span>
                  )}
                  {source.content !== undefined ? (
                    <Markdown
                      key={source.content}
                      content={source.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim()}
                      mode="static"
                      className="prose agent-instruction-content"
                    />
                  ) : (
                    <p className="muted">
                      {(source.kind === "file" && source.error) ||
                        "Instruction content is unavailable. Restart the service to load it."}
                    </p>
                  )}
                </div>
              ))
            ) : (
              <p className="muted">None declared</p>
            )}
          </section>
        )}
      </div>
    </details>
  );
}

export function Settings() {
  return (
    <div className="settings-page">
      <header className="topbar">
        <div className="topbar-left">
          <Link to="/" className="brand-home-link" aria-label="AbraCode main chat">
            <span className="brand-mark" aria-hidden="true">
              a
            </span>
            <strong className="brand-name">AbraCode</strong>
          </Link>
          <span className="topbar-sep" aria-hidden="true" />
          <span className="muted">Settings</span>
        </div>
        <div className="topbar-center">
          <SearchTrigger />
        </div>
        <nav aria-label="Main navigation" className="topbar-end">
          <Link to="/" className="settings-back-link">
            <ArrowLeft aria-hidden="true" />
            <span>Back to workspace</span>
          </Link>
        </nav>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings">
          <Link className="settings-tab" to="/settings" activeOptions={{ exact: true }}>
            Agents
          </Link>
          <Link className="settings-tab" to="/settings/repositories">
            Repositories
          </Link>
          <Link className="settings-tab" to="/settings/appearance">
            Appearance
          </Link>
          <Link className="settings-tab" to="/settings/about">
            About
          </Link>
        </nav>
        <main className="settings-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function AgentSettings() {
  return (
    <div className="settings-stack">
      <div className="settings-heading">
        <div>
          <h1>Agents</h1>
          <p className="muted settings-intro">
            Agent definitions loaded by this installation. Expand an agent to inspect its
            configuration. Changes are made in code.
          </p>
        </div>
        <StatusBadge tone="neutral">Read only</StatusBadge>
      </div>
      <RequestState query={agentsQuery}>
        {({ agents }) =>
          agents.length ? (
            <>
              <p className="settings-count">
                {agents.length} {agents.length === 1 ? "agent" : "agents"} defined
              </p>
              <div className="agent-list">
                {agents.map((agent) => (
                  <AgentDetails key={agent.id} agent={agent} />
                ))}
              </div>
              <p className="muted settings-note">
                Instructions show the authored Markdown. Tools and skills describe declarations;
                effective permissions and task context are determined for each assignment.
              </p>
            </>
          ) : (
            <SectionCard>
              <p className="settings-empty">No agents are defined in this installation.</p>
            </SectionCard>
          )
        }
      </RequestState>
    </div>
  );
}

export function RepositorySettings() {
  const hash = useRouterState({ select: (state) => state.location.hash });
  const run = useContext(RunCommand);
  return (
    <div className="settings-stack">
      <div className="settings-heading">
        <h1>Repositories</h1>
        <div className="row-actions">
          <StatusBadge tone="neutral">Read only</StatusBadge>
          <Button size="sm" onClick={() => run(composerCommands[0])}>
            Onboard repository
          </Button>
        </div>
      </div>
      <RequestState query={repositoriesQuery}>
        {(repositories) =>
          repositories.length ? (
            <>
              <p className="settings-count">
                {repositories.length} {repositories.length === 1 ? "repository" : "repositories"}{" "}
                onboarded
              </p>
              <ul className="settings-repositories">
                {repositories
                  .toSorted((a, b) => a.id.localeCompare(b.id))
                  .map((repository) => (
                    <li
                      key={repository.id}
                      id={"repo-" + repository.id}
                      tabIndex={-1}
                      ref={(element) => {
                        if (element && hash === element.id && document.activeElement !== element) {
                          element.focus({ preventScroll: true });
                          element.scrollIntoView({ block: "nearest" });
                        }
                      }}
                    >
                      <strong>{repository.name}</strong>
                      {repository.name !== repository.id && <code>{repository.id}</code>}
                      {repository.path && <code>{repository.path}</code>}
                    </li>
                  ))}
              </ul>
            </>
          ) : (
            <SectionCard>
              <p className="settings-empty">No repositories have been onboarded yet.</p>
            </SectionCard>
          )
        }
      </RequestState>
    </div>
  );
}

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="settings-stack">
      <h1>Appearance</h1>
      <SectionCard title="Color theme">
        <p className="muted">
          Choose Light, Dark, or follow your operating system. You can also toggle theme directly
          from the bottom of the desktop rail.
        </p>
        <div className="appearance-control">
          <NativeSelect
            aria-label="Color theme"
            value={theme}
            onChange={(e) =>
              setTheme(
                e.target.value === "dark" || e.target.value === "light" ? e.target.value : "system",
              )
            }
          >
            <option value="system">System theme</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </NativeSelect>
        </div>
      </SectionCard>
    </div>
  );
}

export function AboutSettings() {
  return (
    <div className="settings-stack">
      <h1>About AbraCode</h1>
      <SectionCard title="Installation &amp; licenses">
        <p className="muted">
          AbraCode is a local coding orchestrator powered by OpenCode and OpenSpec.
        </p>
        <a
          href="/THIRD_PARTY_NOTICES.txt"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4"
        >
          Third-party licenses <ArrowUpRight aria-hidden="true" />
        </a>
      </SectionCard>
    </div>
  );
}
