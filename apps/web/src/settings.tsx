import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { AgentDefinitionView } from "@abracode/contracts/web/agent-settings";
import { agentsQuery } from "./data.ts";
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
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="agent-definition"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary aria-label={`Inspect ${agent.id}`}>
        <span className="agent-summary">
          <span className="agent-title">
            <strong>{agent.id}</strong>
            <span className="agent-mode">{agent.mode}</span>
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
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            a
          </div>
          <strong>AbraCode</strong>
          <span className="topbar-divider" />
          <span className="muted">Settings</span>
        </div>
        <nav aria-label="Main navigation">
          <Link to="/" className="settings-link">
            Back to workspace
          </Link>
        </nav>
      </header>
      <main className="settings-content">
        <div className="settings-heading">
          <div>
            <p className="settings-eyebrow">Configuration</p>
            <h1>Agents</h1>
          </div>
          <span className="agent-mode">Read only</span>
        </div>
        <p className="muted settings-intro">
          Agent definitions loaded by this installation. Expand an agent to inspect its
          configuration. Changes are made in code.
        </p>
        <RequestState query={agentsQuery}>
          {({ agents }) =>
            agents.length ? (
              <>
                <p className="agent-count">
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
              <p className="settings-empty">No agents are defined in this installation.</p>
            )
          }
        </RequestState>
      </main>
    </div>
  );
}
