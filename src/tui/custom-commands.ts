import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { CommandDefinition } from "./commands.ts";

export interface LoadedCustomCommand {
	definition: CommandDefinition;
	promptTemplate: string;
	sourcePath: string;
}

function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
	if (!raw.startsWith("---")) return { data: {}, body: raw };
	const end = raw.indexOf("\n---", 3);
	if (end < 0) return { data: {}, body: raw };
	const front = raw.slice(3, end).trim();
	const body = raw.slice(end + 4).trim();
	const data: Record<string, string> = {};
	for (const line of front.split(/\r?\n/)) {
		const index = line.indexOf(":");
		if (index < 0) continue;
		data[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
	}
	return { data, body };
}

export function loadProjectCommands(projectRoot: string): LoadedCustomCommand[] {
	const dir = join(projectRoot, ".guardian", "commands");
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.endsWith(".md"))
		.map((name) => {
			const sourcePath = join(dir, name);
			const { data, body } = parseFrontmatter(readFileSync(sourcePath, "utf8"));
			const id = basename(name, ".md").toLowerCase().replace(/[^a-z0-9-]/g, "-");
			const commandName = `/${id}`;
			const definition: CommandDefinition = {
				id,
				name: commandName,
				aliases: [],
				title: data.title || id,
				description: data.description || "Project command",
				category: (data.category as CommandDefinition["category"]) || "System",
				argumentHint: data["argument-hint"],
				keywords: [id, data.agent, data.model].filter(Boolean),
				enabled: true,
				visible: true,
				queueWhileBusy: data["queue-while-busy"] === "true",
				dangerLevel: "none",
				run: id,
				mode: "prompt",
				requiresConfirmation: false,
			};
			return { definition, promptTemplate: body, sourcePath };
		});
}

export function renderCustomCommand(template: string, args: string): string {
	return template.replaceAll("{{args}}", args);
}
