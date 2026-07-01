import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { makeMdComponents } from "@/pages/board/components/ChatComments/markdown";
import "./canvasContent.css";

export function MarkdownBlock({ body }: { body: string }) {
	return (
		<div className="canvas-content text-[13px] leading-relaxed text-[#ededed]">
			<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={makeMdComponents()}>
				{body}
			</ReactMarkdown>
		</div>
	);
}
