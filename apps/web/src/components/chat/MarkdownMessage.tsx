'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Code2, Pencil } from 'lucide-react';
import { JsCode, highlight } from '../CodeView';

// ─── Rule Code collapsible (replaces CREATE_RULE JSON blocks) ─────────────────

interface ParsedRule {
  name?: string;
  symbols?: string[];
  config?: {
    code?: string;
    signal?: string;
    actionType?: string;
    conditions?: { type: string; params?: Record<string, unknown> }[];
    logic?: string;
  };
}

function RuleCodeToggle({
  json,
  onCodeChange,
}: {
  json: string;
  onCodeChange?: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);

  let rule: ParsedRule | null = null;
  try {
    rule = (JSON.parse(json) as { rule?: ParsedRule }).rule ?? null;
  } catch {
    rule = null;
  }

  const code = rule?.config?.code;
  const signal = rule?.config?.signal;
  const actionType = rule?.config?.actionType;

  const [localCode, setLocalCode] = useState(code ?? '');

  const handleCodeChange = (newCode: string) => {
    setLocalCode(newCode);
    onCodeChange?.(newCode);
  };

  const toggleEdit = () => {
    if (!open) setOpen(true);
    setEditMode((v) => !v);
  };

  return (
    <div className="my-2.5 rounded-lg border border-slate-700 bg-slate-950 overflow-hidden text-left">
      {/* Header row — expand toggle + optional edit button side by side */}
      <div className="flex items-center">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex-1 flex items-center gap-2 px-3 py-2 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-900 transition-colors"
        >
          {open ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />}
          <Code2 className="w-3.5 h-3.5 flex-shrink-0" />
          Rule Code
          {signal && (
            <span className="ml-auto text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
              {actionType ? `${actionType} · ` : ''}{signal}
            </span>
          )}
        </button>
        {code && (
          <button
            onClick={toggleEdit}
            title={editMode ? 'View highlighted code' : 'Edit code'}
            className={`px-2.5 py-2 transition-colors flex-shrink-0 ${
              editMode ? 'text-sky-400' : 'text-slate-600 hover:text-slate-300'
            }`}
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
      </div>

      {open && (
        <div className="border-t border-slate-800 px-3 py-2.5 space-y-2">
          {/* Rule meta */}
          {(rule?.name || rule?.symbols?.length) && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {rule?.name && <span className="font-semibold text-slate-200">{rule.name}</span>}
              {rule?.symbols?.map((s) => (
                <span key={s} className="bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded text-[11px]">
                  {s}
                </span>
              ))}
            </div>
          )}

          {/* Code: overlay editor (highlighted + editable) or read-only view */}
          {code ? (
            editMode ? (
              /* Grid overlay: pre provides highlighting + layout; textarea captures input */
              <div className="rounded-lg bg-slate-900 ring-1 ring-sky-500/40 overflow-auto max-h-72">
                <div className="grid">
                  <pre
                    aria-hidden
                    className="[grid-area:1/1] text-xs font-mono leading-relaxed px-3 py-2.5 whitespace-pre text-slate-300 pointer-events-none select-none min-h-[5rem]"
                  >
                    <code>{highlight(localCode + '\n')}</code>
                  </pre>
                  <textarea
                    wrap="off"
                    className="[grid-area:1/1] text-xs font-mono leading-relaxed px-3 py-2.5 bg-transparent resize-none focus:outline-none overflow-hidden border-0"
                    value={localCode}
                    onChange={(e) => handleCodeChange(e.target.value)}
                    spellCheck={false}
                    style={{ color: 'transparent', caretColor: 'white' }}
                  />
                </div>
              </div>
            ) : (
              <JsCode code={localCode} />
            )
          ) : rule?.config?.conditions ? (
            <div className="space-y-1">
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">
                Conditions ({rule.config.logic ?? 'AND'})
              </div>
              {rule.config.conditions.map((c, i) => (
                <div key={i} className="text-xs text-slate-400 bg-slate-900 rounded px-2 py-1 font-mono">
                  {c.type}({Object.entries(c.params ?? {}).map(([k, v]) => `${k}=${v}`).join(', ')})
                </div>
              ))}
            </div>
          ) : (
            <pre className="text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed whitespace-pre">
              <code>{json.trimEnd()}</code>
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Regular code block ───────────────────────────────────────────────────────

function CodeBlock({ lang, code, partial }: { lang: string; code: string; partial?: boolean }) {
  return (
    <div className={`my-2.5 rounded-lg overflow-hidden border bg-slate-950 text-left ${partial ? 'border-slate-600' : 'border-slate-700'}`}>
      {lang && (
        <div className="flex items-center px-3 py-1.5 bg-slate-900 border-b border-slate-700">
          <span className="text-[11px] font-mono text-slate-400">{lang}</span>
          {partial && <span className="ml-2 text-[10px] text-slate-600 italic">streaming…</span>}
        </div>
      )}
      <pre className="p-3 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed whitespace-pre">
        <code>{code.trimEnd()}</code>
      </pre>
    </div>
  );
}

// ─── Inline text (bold, inline code) ─────────────────────────────────────────

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-slate-100">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={i} className="bg-slate-800 text-sky-300 px-1.5 py-0.5 rounded text-[11px] font-mono">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part || null;
  });
}

// ─── Block-level text renderer ────────────────────────────────────────────────

function TextBlocks({ text }: { text: string }) {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Headings: # / ## / ###
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const cls =
        level === 1
          ? 'text-base font-bold text-slate-100 mt-3 mb-1'
          : level === 2
          ? 'text-sm font-bold text-slate-100 mt-2.5 mb-1'
          : 'text-sm font-semibold text-slate-200 mt-2 mb-0.5';
      nodes.push(
        <div key={i} className={cls}>
          {renderInline(headingMatch[2])}
        </div>,
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|_{3,})$/.test(line.trim())) {
      nodes.push(<hr key={i} className="border-slate-700 my-3" />);
      i++;
      continue;
    }

    // Bullet list: consecutive lines starting with - / • / *
    if (/^[-•*]\s/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^[-•*]\s/.test(lines[i])) {
        const content = lines[i].replace(/^[-•*]\s/, '');
        items.push(
          <li key={i} className="flex gap-2 items-start">
            <span className="text-slate-500 flex-shrink-0 mt-px select-none">•</span>
            <span>{renderInline(content)}</span>
          </li>,
        );
        i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="space-y-0.5 my-1.5">
          {items}
        </ul>,
      );
      continue;
    }

    // Empty line → small spacer
    if (line.trim() === '') {
      nodes.push(<div key={i} className="h-1.5" />);
      i++;
      continue;
    }

    // Regular line — flow adjacent non-empty lines together
    const nextLine = lines[i + 1];
    const nextIsBreak =
      !nextLine ||
      nextLine.trim() === '' ||
      /^[-•*#{]/.test(nextLine) ||
      /^(-{3,}|_{3,})$/.test(nextLine.trim());

    nodes.push(
      <span key={i}>
        {renderInline(line)}
        {nextIsBreak ? <br /> : ' '}
      </span>,
    );
    i++;
  }

  return <>{nodes}</>;
}

// ─── Parse content into segments ──────────────────────────────────────────────

type Segment =
  | { type: 'text'; value: string }
  | { type: 'rule-json'; json: string }
  | { type: 'code'; lang: string; value: string; partial?: boolean };

function parseSegments(content: string, streaming: boolean): Segment[] {
  const segments: Segment[] = [];
  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: content.slice(lastIndex, match.index) });
    }

    const lang = match[1] || '';
    const code = match[2];

    // Detect CREATE_RULE JSON block and replace with collapsible
    if (lang === 'json') {
      try {
        const parsed = JSON.parse(code);
        if (parsed?.action === 'CREATE_RULE') {
          segments.push({ type: 'rule-json', json: code });
          lastIndex = regex.lastIndex;
          continue;
        }
      } catch {
        // not parseable — fall through to normal code block
      }
    }

    segments.push({ type: 'code', lang, value: code });
    lastIndex = regex.lastIndex;
  }

  // Remaining text (may contain partial/unclosed code block)
  if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex);
    const openFenceIdx = remaining.indexOf('```');

    if (openFenceIdx !== -1 && streaming) {
      if (openFenceIdx > 0) {
        segments.push({ type: 'text', value: remaining.slice(0, openFenceIdx) });
      }
      const fenceContent = remaining.slice(openFenceIdx + 3);
      const langMatch = fenceContent.match(/^(\w*)\n?/);
      const lang = langMatch?.[1] ?? '';
      const code = fenceContent.replace(/^\w*\n?/, '');
      segments.push({ type: 'code', lang, value: code, partial: true });
    } else {
      segments.push({ type: 'text', value: remaining });
    }
  }

  return segments;
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  content: string;
  streaming?: boolean;
  onCodeChange?: (code: string) => void;
}

export default function MarkdownMessage({ content, streaming = false, onCodeChange }: Props) {
  const segments = parseSegments(content, streaming);

  if (segments.length === 0) {
    return <span className="cursor-blink" />;
  }

  return (
    <div>
      {segments.map((seg, i) => {
        if (seg.type === 'rule-json') {
          return <RuleCodeToggle key={i} json={seg.json} onCodeChange={onCodeChange} />;
        }

        if (seg.type === 'code') {
          return (
            <CodeBlock
              key={i}
              lang={seg.lang}
              code={seg.value}
              partial={seg.partial}
            />
          );
        }

        // text segment
        const isLast = i === segments.length - 1;
        return (
          <span key={i} className={streaming && isLast ? 'cursor-blink' : undefined}>
            <TextBlocks text={seg.value} />
          </span>
        );
      })}
    </div>
  );
}
