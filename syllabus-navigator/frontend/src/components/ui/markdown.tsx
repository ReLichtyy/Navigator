import React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import "katex/dist/katex.min.css"
import { cn } from "@/lib/utils"

interface MarkdownProps {
  content: string
  className?: string
}

export function Markdown({ content, className }: MarkdownProps) {
  return (
    <div className={cn("prose prose-sm dark:prose-invert max-w-none break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ node, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline font-medium"
            />
          ),
          p: ({ node, ...props }) => <p {...props} className="leading-relaxed mb-4 last:mb-0" />,
          ul: ({ node, ...props }) => <ul {...props} className="list-disc pl-5 mb-4 space-y-1" />,
          ol: ({ node, ...props }) => (
            <ol {...props} className="list-decimal pl-5 mb-4 space-y-1" />
          ),
          li: ({ node, ...props }) => <li {...props} className="leading-relaxed" />,
          pre: ({ node, ...props }) => (
            <pre
              {...props}
              className="bg-secondary/50 rounded-md p-4 overflow-x-auto mb-4 border border-border/50 text-[13px]"
            />
          ),
          code: ({ node, className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || "")
            const isInline =
              !match &&
              !className?.includes("language-") &&
              typeof children === "string" &&
              !children.includes("\n")

            if (isInline) {
              return (
                <code
                  {...props}
                  className="bg-secondary/50 rounded px-1.5 py-0.5 text-[13px] font-mono text-primary"
                >
                  {children}
                </code>
              )
            }
            return (
              <code {...props} className={cn("font-mono", className)}>
                {children}
              </code>
            )
          },
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto mb-4">
              <table {...props} className="w-full text-sm border-collapse" />
            </div>
          ),
          th: ({ node, ...props }) => (
            <th
              {...props}
              className="border border-border bg-secondary/50 px-3 py-2 text-left font-semibold"
            />
          ),
          td: ({ node, ...props }) => <td {...props} className="border border-border px-3 py-2" />,
          blockquote: ({ node, ...props }) => (
            <blockquote
              {...props}
              className="border-l-4 border-accent pl-4 italic text-muted-foreground mb-4"
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
