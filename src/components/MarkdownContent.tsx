import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';

interface MarkdownContentProps {
  children: string;
}

/**
 * Renders Markdown notes with the app's styling. Shared by the MarkdownEditor
 * Preview tab and the read-only views of the same notes, so they look alike.
 * Raw HTML in the source is not rendered (react-markdown's default, no rehype-raw).
 * A single line break stays a line break (remark-breaks): most notes were
 * written as plain text before they were rendered as Markdown.
 */
export default function MarkdownContent({ children }: MarkdownContentProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkBreaks]}
      components={{
        // Style headings
        h1: ({ node, children, ...props }) => <h1 className="text-gray-900 mt-6 mb-4" {...props}>{children}</h1>,
        h2: ({ node, children, ...props }) => <h2 className="text-gray-900 mt-5 mb-3" {...props}>{children}</h2>,
        h3: ({ node, children, ...props }) => <h3 className="text-gray-900 mt-4 mb-2" {...props}>{children}</h3>,
        h4: ({ node, children, ...props }) => <h4 className="text-gray-900 mt-3 mb-2" {...props}>{children}</h4>,
        h5: ({ node, children, ...props }) => <h5 className="text-gray-900 mt-3 mb-2" {...props}>{children}</h5>,
        h6: ({ node, children, ...props }) => <h6 className="text-gray-900 mt-3 mb-2" {...props}>{children}</h6>,
        // Style paragraphs
        p: ({ node, ...props }) => <p className="text-gray-700 mb-4 leading-relaxed" {...props} />,
        // Style lists
        ul: ({ node, ...props }) => <ul className="list-disc list-inside mb-4 text-gray-700 space-y-1" {...props} />,
        ol: ({ node, ...props }) => <ol className="list-decimal list-inside mb-4 text-gray-700 space-y-1" {...props} />,
        li: ({ node, ...props }) => <li className="text-gray-700" {...props} />,
        // Style links
        a: ({ node, children, ...props }) => (
          <a className="text-sky-600 hover:text-sky-700 underline" target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
        ),
        // Style code
        code: ({ node, inline, ...props }: any) =>
          inline ? (
            <code className="bg-gray-100 text-red-600 px-1.5 py-0.5 rounded text-sm" {...props} />
          ) : (
            <code className="block bg-gray-100 text-gray-800 p-3 rounded text-sm overflow-x-auto" {...props} />
          ),
        pre: ({ node, ...props }) => <pre className="mb-4" {...props} />,
        // Style blockquotes
        blockquote: ({ node, ...props }) => (
          <blockquote className="border-l-4 border-gray-300 pl-4 italic text-gray-600 mb-4" {...props} />
        ),
        // Style strong/bold
        strong: ({ node, ...props }) => <strong className="text-gray-900" {...props} />,
        // Style emphasis/italic
        em: ({ node, ...props }) => <em className="text-gray-700" {...props} />,
        // Style horizontal rules
        hr: ({ node, ...props }) => <hr className="my-6 border-gray-300" {...props} />,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
