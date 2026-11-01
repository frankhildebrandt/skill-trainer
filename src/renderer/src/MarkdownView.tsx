import type { ReactNode } from "react";
import { parseInline, parseMarkdown, type Inline } from "./markdown";

export function MarkdownView({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  if (blocks.length === 0) return null;
  return (
    <div className="md">
      {blocks.map((block, index) => {
        if (block.type === "h") {
          const Tag = (`h${block.level}` as "h1" | "h2" | "h3");
          return <Tag key={index}>{renderInlines(block.inlines)}</Tag>;
        }
        if (block.type === "code") {
          return <pre key={index}><code>{block.text}</code></pre>;
        }
        if (block.type === "ul" || block.type === "ol") {
          const Tag = block.type === "ul" ? "ul" : "ol";
          return (
            <Tag key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlines(item)}</li>
              ))}
            </Tag>
          );
        }
        if (block.type === "table") {
          return (
            <div key={index} className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {block.header.map((cell, cellIndex) => (
                      <th key={cellIndex}>{renderInlines(cell)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{renderInlines(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={index}>{renderInlines(block.inlines)}</p>;
      })}
    </div>
  );
}

function renderInlines(parts: Inline[]): ReactNode[] {
  return parts.map((part, index) => {
    if (part.type === "code") return <code key={index}>{part.text}</code>;
    if (part.type === "strong") return <strong key={index}>{part.text}</strong>;
    if (part.type === "em") return <em key={index}>{part.text}</em>;
    return <span key={index}>{part.text}</span>;
  });
}
