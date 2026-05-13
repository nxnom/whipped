const PREFIX_MAP: [RegExp, string][] = [
	[/^(fix|fixes|fixed|bugfix|hotfix)[:\s_-]/, "fix"],
	[/^(feat|feature|add|implement|new)[:\s_-]/, "feat"],
	[/^(refactor|rework|restructure|rename|move)[:\s_-]/, "refactor"],
	[/^(chore|update|upgrade|bump|cleanup|clean\s*up)[:\s_-]/, "chore"],
	[/^(test|tests|testing)[:\s_-]/, "test"],
	[/^(docs?|document|documentation)[:\s_-]/, "docs"],
	[/^(style|format|lint)[:\s_-]/, "style"],
];

export function deriveBranchName(title: string): string {
	const lower = title.toLowerCase().trim();
	let prefix = "feat";
	let rest = lower;

	for (const [re, p] of PREFIX_MAP) {
		const m = lower.match(re);
		if (m) {
			prefix = p;
			rest = lower.slice(m[0].length).trim();
			break;
		}
	}

	const slug = rest
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 60);
	return slug ? `${prefix}/${slug}` : "";
}
