'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Send, Bot, User, Trash2, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import MarkdownMessage from '@/components/chat/MarkdownMessage';

interface Message {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

interface RulePayload {
  action: string;
  rule: {
    name: string;
    description: string;
    symbols: string[];
    poolType?: 'FIXED' | 'DYNAMIC';
    poolFilterCode?: string;
    config: unknown;
  };
}

const WELCOME_MSG: Message = {
  role: 'assistant',
  content:
    '你好！我是 AI 股票分析助手。請告訴我您想要設定什麼樣的股票監控規則，例如：\n\n• 「當台積電(2330)股價突破20日均線且RSI低於30時通知我」\n• 「當5日均線死叉20日均線時發出賣出訊號」\n• 「當成交量暴增2倍且創52週新高時買入」\n\n我會將您的需求轉換成可執行的監控規則！',
};

// Immutable helpers — never mutate the message objects in prev state
function appendToLast(prev: Message[], chunk: string): Message[] {
  const last = prev[prev.length - 1];
  if (!last?.streaming) return prev;
  return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
}

function finalizeLast(prev: Message[]): Message[] {
  const last = prev[prev.length - 1];
  if (!last?.streaming) return prev;
  return [...prev.slice(0, -1), { ...last, streaming: false }];
}

function errorLast(prev: Message[]): Message[] {
  const last = prev[prev.length - 1];
  if (!last?.streaming) return prev;
  return [
    ...prev.slice(0, -1),
    { ...last, content: 'Sorry, an error occurred. Please try again.', streaming: false },
  ];
}

function ChatContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [sessionId] = useState<string>(() => {
    const fromUrl = searchParams.get('session');
    return fromUrl ?? `session-${Date.now()}`;
  });

  const isResumingSession = !!searchParams.get('session');

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingRule, setPendingRule] = useState<RulePayload['rule'] | null>(null);
  const [editingCode, setEditingCode] = useState<string>('');
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isResumingSession) {
      setMessages([WELCOME_MSG]);
      setHistoryLoaded(true);
      return;
    }

    api.getMessages(sessionId)
      .then((history) => {
        const msgs = history as { role: string; content: string }[];
        setMessages(
          msgs.length === 0
            ? [WELCOME_MSG]
            : msgs.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        );
      })
      .catch(() => setMessages([WELCOME_MSG]))
      .finally(() => setHistoryLoaded(true));
  }, [sessionId, isResumingSession]);

  useEffect(() => {
    if (historyLoaded) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, historyLoaded]);

  // Sync editingCode when a new pending rule arrives so saveRule picks up the right code
  useEffect(() => {
    if (pendingRule) {
      const code = (pendingRule.config as { code?: string })?.code ?? '';
      setEditingCode(code);
    }
  }, [pendingRule]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput('');
    setLoading(true);

    // Append user message then an empty streaming assistant message — both immutably
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: userMsg },
      { role: 'assistant', content: '', streaming: true },
    ]);

    try {
      const res = await fetch(`/api/chat/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg }),
      });

      if (!res.body) throw new Error('No response stream');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6)) as {
              type: string;
              content?: string;
              data?: RulePayload;
            };

            if (event.type === 'chunk' && event.content) {
              // Use immutable update — never mutate prev objects
              setMessages((prev) => appendToLast(prev, event.content!));
            } else if (event.type === 'rule' && event.data?.action === 'CREATE_RULE') {
              setPendingRule(event.data.rule);
            } else if (event.type === 'done') {
              setMessages((prev) => finalizeLast(prev));
            }
          } catch {
            // malformed SSE line — skip
          }
        }
      }
    } catch {
      setMessages((prev) => errorLast(prev));
    } finally {
      setLoading(false);
    }
  }, [input, loading, sessionId]);

  const saveRule = async () => {
    if (!pendingRule) return;
    try {
      // Merge any manual edits back into the config before saving
      const config = {
        ...(pendingRule.config as Record<string, unknown>),
        ...(editingCode ? { code: editingCode } : {}),
      };
      await api.createRule({ ...pendingRule, config, sessionId });
      const name = pendingRule.name;
      setPendingRule(null);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `✅ 規則「${name}」已成功儲存！您可以在 Dashboard 頁面查看和管理它。` },
      ]);
    } catch {
      alert('Failed to save rule');
    }
  };

  const clearChat = async () => {
    await api.clearChat(sessionId);
    setPendingRule(null);
    setMessages([{ role: 'assistant', content: '對話已清除。請告訴我您想設定什麼股票監控規則？' }]);
    if (isResumingSession) router.replace('/chat');
  };

  if (!historyLoaded) {
    return (
      <div className="flex items-center justify-center flex-1 text-slate-500 text-sm">
        Loading conversation...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-slate-100">AI Agent Chat</h1>
          {isResumingSession ? (
            <p className="text-xs text-sky-500">Resumed session · {sessionId}</p>
          ) : (
            <p className="text-xs text-slate-500">Describe your stock strategy, AI builds the rule</p>
          )}
        </div>
        <button onClick={clearChat} className="btn-ghost text-xs flex items-center gap-1.5">
          <Trash2 className="w-3.5 h-3.5" />
          Clear
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-sky-600/20 border border-sky-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot className="w-4 h-4 text-sky-400" />
              </div>
            )}

            <div
              className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-sky-600 text-white rounded-br-sm whitespace-pre-wrap'
                  : 'card text-slate-200 rounded-bl-sm'
              }`}
            >
              {msg.role === 'assistant' ? (
                <MarkdownMessage
                  content={msg.content}
                  streaming={msg.streaming}
                  onCodeChange={setEditingCode}
                />
              ) : (
                msg.content
              )}
            </div>

            {msg.role === 'user' && (
              <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                <User className="w-4 h-4 text-slate-300" />
              </div>
            )}
          </div>
        ))}

        {pendingRule && (
          <div className="card border-emerald-500/30 p-4 bg-emerald-500/5 ml-10 space-y-3">
            <div>
              <p className="text-sm font-medium text-emerald-400 mb-0.5">Rule ready to save: {pendingRule.name}</p>
              <p className="text-xs text-slate-400">{pendingRule.description}</p>
              {(pendingRule.poolType ?? 'FIXED') === 'DYNAMIC' ? (
                <p className="text-xs text-purple-400 mt-0.5">
                  動態選股池 — <code className="font-mono">{pendingRule.poolFilterCode}</code>
                </p>
              ) : (
                <p className="text-xs text-slate-500 mt-0.5">Symbols: {pendingRule.symbols.join(', ')}</p>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={saveRule} className="btn-primary text-xs flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                Save Rule
              </button>
              <button onClick={() => setPendingRule(null)} className="btn-ghost text-xs">
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-slate-800 p-4">
        <div className="flex gap-2 max-w-4xl mx-auto">
          <input
            className="input flex-1"
            placeholder={loading ? '等待 AI 回覆中…' : 'Describe your stock monitoring rule...'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!loading) sendMessage();
              }
            }}
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="btn-primary flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center flex-1 text-slate-500 text-sm">Loading...</div>
    }>
      <ChatContent />
    </Suspense>
  );
}
