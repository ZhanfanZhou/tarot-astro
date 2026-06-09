import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// The repo hoists a React 19 @types copy at the root while the frontend uses
// React 18 types; that mismatch makes react-markdown's JSX signature unassignable.
// Cast to a permissive component type — runtime behaviour is unaffected.
const MD = ReactMarkdown as unknown as React.ComponentType<any>;

/**
 * Themed markdown renderer for the oracle's readings.
 * Styling lives in `.md` rules in index.css. react-markdown escapes raw HTML
 * by default, so this is safe for model-generated content.
 */
const Markdown: React.FC<{ content: string }> = ({ content }) => (
  <div className="md">
    <MD
      remarkPlugins={[remarkGfm]}
      components={{
        a: (props: any) => <a {...props} target="_blank" rel="noopener noreferrer" />,
      }}
    >
      {content}
    </MD>
  </div>
);

export default Markdown;
