"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";

/** Assistant markdown. Fenced code renders as a copyable CodeBlock; inline code
 * renders as a subtle chip. GitHub-flavored markdown (tables, lists). */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-chat text-[15px] text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const text = String(children ?? "");
            const langMatch = /language-(\w+)/.exec(className ?? "");
            const isBlock = Boolean(langMatch) || text.includes("\n");
            if (!isBlock) {
              return <code>{children}</code>;
            }
            return (
              <CodeBlock code={text.replace(/\n$/, "")} language={langMatch?.[1]} />
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
