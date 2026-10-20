import { Fragment, type ReactNode } from "react";

/**
 * Minimal Markdown for agent replies: headings, bullet/numbered lists, tables, **bold**, `code`.
 * Rendered as React elements (no innerHTML), so model output cannot inject markup.
 */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export default function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) body.push(cells(lines[i++]));
      i--;
      out.push(
        <table key={i} className="md-table">
          <thead><tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
          <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
        </table>,
      );
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ""));
      i--;
      const List = ordered ? "ol" : "ul";
      out.push(<List key={i}>{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</List>);
    } else if (/^#{1,6}\s/.test(line)) {
      out.push(<div key={i} className="md-h">{inline(line.replace(/^#+\s*/, ""))}</div>);
    } else if (line.trim()) {
      out.push(<p key={i}>{inline(line)}</p>);
    }
  }
  return <div className="md">{out}</div>;
}
