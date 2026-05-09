export type AgentId = "build" | "plan" | "audit" | "fleet";
export type PermissionName = "edit" | "shell" | "read" | "web" | "mcp" | "fleet" | "git";
export type PermissionState = "allow" | "ask" | "deny";

export interface AgentDefinition {
	id: AgentId;
	title: string;
	description: string;
	mode: "build" | "plan" | "audit" | "fleet";
	model: string;
	prompt: string;
	permissions: Record<PermissionName, PermissionState>;
	color: string;
	maxSteps: number;
	hidden: boolean;
}

const basePermissions: Record<PermissionName, PermissionState> = {
	edit: "ask",
	shell: "ask",
	read: "allow",
	web: "ask",
	mcp: "ask",
	fleet: "ask",
	git: "ask",
};

export const agentRegistry: AgentDefinition[] = [
	{
		id: "build",
		title: "Build",
		description: "Implementation-focused agent with guarded edit and tool access.",
		mode: "build",
		model: "auto",
		prompt:
			"Help implement and debug practical engineering work. Be concrete, preserve user changes, and request permission before risky tools.",
		permissions: { ...basePermissions, edit: "ask", shell: "ask", git: "ask" },
		color: "green",
		maxSteps: 12,
		hidden: false,
	},
	{
		id: "plan",
		title: "Plan",
		description: "Read-only architecture, planning, and risk analysis.",
		mode: "plan",
		model: "auto",
		prompt:
			"Stay read-only. Focus on architecture, sequencing, assumptions, and risk. Do not imply code was changed.",
		permissions: { ...basePermissions, edit: "deny", shell: "ask", git: "allow" },
		color: "cyan",
		maxSteps: 8,
		hidden: false,
	},
	{
		id: "audit",
		title: "Audit",
		description: "Review, security, budget, routing, and reliability focused agent.",
		mode: "audit",
		model: "auto",
		prompt:
			"Focus on defects, regressions, security, cost, routing, budgets, logs, Semantic Folding, VCM Sharding, and reliability.",
		permissions: { ...basePermissions, edit: "deny", shell: "ask", git: "allow" },
		color: "amber",
		maxSteps: 10,
		hidden: false,
	},
	{
		id: "fleet",
		title: "Fleet",
		description: "Orchestration-focused agent for safe subagent planning.",
		mode: "fleet",
		model: "auto",
		prompt:
			"Plan bounded parallel work honestly. Do not claim worker fan-out is complete unless execution, isolation, budgets, cancellation, and merge controls are actually active.",
		permissions: { ...basePermissions, edit: "deny", shell: "ask", fleet: "ask" },
		color: "blue",
		maxSteps: 6,
		hidden: false,
	},
];

export function visibleAgents(): AgentDefinition[] {
	return agentRegistry.filter((agent) => !agent.hidden);
}

export function findAgent(input: string): AgentDefinition | undefined {
	const normalized = input.replace(/^@/, "").toLowerCase();
	return agentRegistry.find(
		(agent) =>
			agent.id === normalized ||
			agent.title.toLowerCase() === normalized ||
			`@${agent.id}` === input.toLowerCase(),
	);
}

export function nextAgent(current: AgentDefinition, direction = 1): AgentDefinition {
	const agents = visibleAgents();
	const index = agents.findIndex((agent) => agent.id === current.id);
	return agents[(index + direction + agents.length) % agents.length] ?? current;
}

export function agentHelp(): string {
	return agentRegistry
		.map(
			(agent) =>
				`@${agent.id.padEnd(8)} ${agent.title.padEnd(8)} ${agent.description}`,
		)
		.join("\n");
}
