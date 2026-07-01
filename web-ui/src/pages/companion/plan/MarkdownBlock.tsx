import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { makeMdComponents } from "@/pages/board/components/ChatComments/markdown";

export function MarkdownBlock({ body }: { body: string }) {
	return (
		<div className="text-[13px] leading-relaxed text-gray-300">
			<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={makeMdComponents()}>
				{body}
			</ReactMarkdown>
		</div>
	);
}
