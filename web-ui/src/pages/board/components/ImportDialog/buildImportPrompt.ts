import { runtimeCardPrioritySchema, tierLevelSchema, type Workflow } from "@runtime-contract";

const workflowLine = (w: Workflow): string => `  - ${w.id} — ${w.name}${w.isDefault ? " (default)" : ""}`;

// Builds a copy-paste prompt for any AI assistant so it returns JSON that drops
// straight into the importer. It embeds the live workflow ids/names and the allowed
// enums, and only documents story/subtask tickets when a story workflow exists.
export function buildImportPrompt(workflows: Workflow[]): string {
	const taskWorkflows = workflows.filter((w) => !w.forStory);
	const storyWorkflows = workflows.filter((w) => w.forStory);
	const hasStory = storyWorkflows.length > 0;

	const sections: string[] = [];

	sections.push(
		"You generate tickets for the Whipped kanban board. Return your answer as a single ```json fenced code block containing a JSON array of ticket objects, and nothing else — no prose before or after the block.",
	);

	const fields = [
		'- "description" (string, required): the ticket body. Its FIRST line is the title.',
		`- "workflowId" (string, optional): one of the workflow ids below. If omitted or unknown, the default workflow is used.`,
		`- "priority" (string, optional): one of ${runtimeCardPrioritySchema.options.join(", ")}.`,
		`- "activeLevel" (string, optional): one of ${tierLevelSchema.options.join(", ")}.`,
		'- "branchName" (string, optional): "<type>/<slug>"; auto-derived from the title if omitted.',
	];
	if (hasStory) {
		fields.push(
			'- "type" (string, optional): "task" (default), "story", or "subtask".',
			'- "tempId" (string, optional): a local id so other rows can reference this ticket within the same import.',
			'- "dependsOn" (string, optional): a tempId — this ticket continues in that ticket\'s branch once it reaches review.',
			'- "waitsFor" (string[], optional): tempIds — this ticket starts fresh once all listed tickets are merged. Mutually exclusive with dependsOn.',
			'- "subtaskIds" (string[], optional): on a "story", the tempIds of its subtasks.',
		);
	} else {
		fields.push(
			'- "tempId" (string, optional): a local id so other rows can reference this ticket within the same import.',
			'- "dependsOn" (string, optional): a tempId — this ticket continues in that ticket\'s branch once it reaches review.',
			'- "waitsFor" (string[], optional): tempIds — this ticket starts fresh once all listed tickets are merged. Mutually exclusive with dependsOn.',
		);
	}
	sections.push(`Each ticket object supports these fields:\n${fields.join("\n")}`);

	const wfSections = [
		`Task workflows (use these ids for normal tickets):\n${taskWorkflows.map(workflowLine).join("\n")}`,
	];
	if (hasStory) {
		wfSections.push(
			`Story workflows (use these ids on "type": "story" tickets):\n${storyWorkflows.map(workflowLine).join("\n")}`,
		);
	}
	sections.push(wfSections.join("\n\n"));

	const example = hasStory
		? `[
  {
    "tempId": "epic",
    "type": "story",
    "description": "Checkout revamp\\n\\nSplit the checkout flow into payment and shipping steps.",
    "workflowId": "${storyWorkflows[0]?.id ?? "wf_story_default"}",
    "subtaskIds": ["pay", "ship"]
  },
  {
    "tempId": "pay",
    "type": "subtask",
    "description": "Build the payment step",
    "workflowId": "${taskWorkflows[0]?.id ?? "wf_default"}"
  },
  {
    "tempId": "ship",
    "type": "subtask",
    "description": "Build the shipping step",
    "dependsOn": "pay",
    "priority": "high"
  }
]`
		: `[
  {
    "description": "Add a dark mode toggle\\n\\nPersist the choice in localStorage.",
    "workflowId": "${taskWorkflows[0]?.id ?? "wf_default"}",
    "priority": "high"
  },
  {
    "description": "Rate-limit the login endpoint"
  }
]`;
	sections.push(`Example output:\n\`\`\`json\n${example}\n\`\`\``);

	return sections.join("\n\n");
}
