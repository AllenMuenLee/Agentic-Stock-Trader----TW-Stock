'use client';

import React from 'react';

// Lightweight, dependency-free JavaScript syntax highlighter. Tokenizes one
// token at a time (comments → strings → numbers → keywords → builtins) so
// matches never overlap, then colors each token with a Tailwind class.

const KEYWORDS =
  'const|let|var|function|return|if|else|for|while|do|break|continue|new|typeof|instanceof|of|in|switch|case|default|try|catch|finally|throw';
const LITERALS = 'true|false|null|undefined|NaN|Infinity';
const BUILTINS = 'get_data|get_detail|get_price|get_indicator|get_meta|get_bars|get_candle|stock|curr_time|Math|Number|JSON';

const TOKEN = new RegExp(
  [
    '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)', // 1: comments
    '(`(?:\\\\.|[^`\\\\])*`|\'(?:\\\\.|[^\'\\\\])*\'|"(?:\\\\.|[^"\\\\])*")', // 2: strings
    '(\\b\\d+(?:\\.\\d+)?\\b)', // 3: numbers
    `(\\b(?:${KEYWORDS})\\b)`, // 4: keywords
    `(\\b(?:${LITERALS})\\b)`, // 5: literals
    `(\\b(?:${BUILTINS})\\b)`, // 6: builtins / injected API
  ].join('|'),
  'g',
);

function highlight(code: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;

  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(code)) !== null) {
    if (m.index > last) nodes.push(code.slice(last, m.index));

    const [full, comment, str, num, kw, lit, builtin] = m;
    let cls = '';
    if (comment) cls = 'text-slate-500 italic';
    else if (str) cls = 'text-emerald-400';
    else if (num) cls = 'text-amber-300';
    else if (kw) cls = 'text-sky-400';
    else if (lit) cls = 'text-rose-400';
    else if (builtin) cls = 'text-purple-400';

    nodes.push(
      <span key={key++} className={cls}>
        {full}
      </span>,
    );
    last = m.index + full.length;
  }
  if (last < code.length) nodes.push(code.slice(last));
  return nodes;
}

export { highlight };

/** Renders a JavaScript snippet with syntax highlighting in a styled code block. */
export function JsCode({ code, className = '' }: { code: string; className?: string }) {
  return (
    <pre
      className={`text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed whitespace-pre ${className}`}
    >
      <code>{highlight(code.trimEnd())}</code>
    </pre>
  );
}
