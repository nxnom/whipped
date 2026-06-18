import type { RuntimeBulkCardImportItem } from "@runtime-contract";

// One parsed row of the pasted JSON. `item` is the cleaned payload sent to the API
// (only set when the row has no errors). `errors` are human-readable validation
// messages; `defaulted` flags that the workflow fell back to the default.
export interface ParsedImportRow {
	index: number;
	title: string;
	type: string;
	priority: string;
	resolvedWorkflowName: string;
	defaulted: boolean;
	deps: string[];
	errors: string[];
	item?: RuntimeBulkCardImportItem;
}

export interface ParsedImport {
	rows: ParsedImportRow[];
	// A top-level parse error (not valid JSON / not an array). When set, `rows` is empty.
	fatal?: string;
	valid: boolean;
}
