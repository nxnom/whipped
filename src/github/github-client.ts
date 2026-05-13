import { graphql } from "@octokit/graphql";
import { Octokit } from "@octokit/rest";

export interface GithubIssueComment {
	issueUrl: string;
	body: string;
}

export function createGithubClient(token: string) {
	const octokit = new Octokit({ auth: token });
	const _gql = graphql.defaults({ headers: { authorization: `token ${token}` } });

	return {
		async postComment(issueUrl: string, body: string): Promise<void> {
			const match = issueUrl.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
			if (!match) {
				throw new Error(`Invalid GitHub issue URL: ${issueUrl}`);
			}
			const [, owner, repo, issueNumberStr] = match;
			await octokit.issues.createComment({
				owner: owner!,
				repo: repo!,
				issue_number: Number(issueNumberStr),
				body,
			});
		},

		async createPullRequest(options: {
			repoPath: string;
			owner: string;
			repo: string;
			title: string;
			body: string;
			head: string;
			base: string;
		}): Promise<string> {
			const { owner, repo, title, body, head, base } = options;
			const response = await octokit.pulls.create({ owner, repo, title, body, head, base });
			return response.data.html_url;
		},

		async getRepoInfo(owner: string, repo: string): Promise<{ defaultBranch: string }> {
			const response = await octokit.repos.get({ owner, repo });
			return { defaultBranch: response.data.default_branch };
		},
	};
}

export type GithubClient = ReturnType<typeof createGithubClient>;
