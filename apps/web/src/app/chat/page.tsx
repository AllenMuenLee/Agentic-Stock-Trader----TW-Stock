'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Send, Bot, User, Trash2, Plus, MessageSquare, ArrowLeft, Zap, Database, ChevronRight, Clock } from 'lucide-react';
import Link from 'next/link';
import { api, BASE } from '@/lib/api';
import MarkdownMessage from '@/components/chat/MarkdownMessage';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
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

interface SessionSummary {
  sessionId: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  preview: string;
  rule: { id: string; name: string; isActive: boolean; poolType: string } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WELCOME_MSG: Message = {
  role: 'assistant',
  content:
    '你好！我是 AI 股票分析助手。請告訴我您想要設定什麼樣的股票監控規則，例如：\n\n• 「當台積電(2330)股價突破20日均線且RSI低於30時通知我」\n• 「當5日均線死叉20日均線時發出賣出訊號」\n• 「當成交量暴增2倍且創52週新高時買入」\n\n我會將您的需求轉換成可執行的監控規則！',
};

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
    { ...last, content: '抱歉，發生錯誤，請稍後再試。', streaming: false },
  ];
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '剛剛';
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}

// ─── History list (shown when no ?session= in URL) ────────────────────────────

function ChatHistoryList() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    api.getChatSessions()
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  const deleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDeletingId(sessionId);
    try {
      await api.clearChat(sessionId);
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  };

  const startNewChat = () => {
    router.push(`/chat?session=session-${Date.now()}`);
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">

      {/* Page header */}
      <div className="flex items-start justify-between mb-10">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">AI 助手</h1>
          <p className="text-sm text-slate-500 mt-1.5">
            對話記錄與建立的監控規則
          </p>
        </div>
        <button
          onClick={startNewChat}
          className="btn-primary flex items-center gap-2 text-sm mt-1"
        >
          <Plus className="w-4 h-4" />
          新對話
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-24 text-slate-600 text-sm gap-2">
          <Clock className="w-4 h-4 animate-pulse" />
          載入中…
        </div>
      )}

      {/* Empty state */}
      {!loading && sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-800/60 border border-slate-700/50 flex items-center justify-center mb-5">
            <MessageSquare className="w-7 h-7 text-slate-600" />
          </div>
          <p className="text-slate-300 font-medium mb-1.5">尚無對話記錄</p>
          <p className="text-slate-600 text-sm max-w-xs">
            開始對話並描述您的股票策略，AI 將自動建立監控規則。
          </p>
          <button
            onClick={startNewChat}
            className="btn-primary text-sm mt-6 inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            開始第一個對話
          </button>
        </div>
      )}

      {/* Session cards */}
      {sessions.length > 0 && (
        <div className="space-y-3">
          {sessions.map((session) => (
            <Link
              key={session.sessionId}
              href={`/chat?session=${session.sessionId}`}
              className="block card p-6 hover:border-slate-700 hover:bg-slate-800/40 transition-all group"
            >
              {/* Top row: timestamp + actions */}
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-slate-600 flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />
                  {relativeTime(session.updatedAt)}
                  <span className="text-slate-700">·</span>
                  {session.messageCount} 則訊息
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => deleteSession(e, session.sessionId)}
                    disabled={deletingId === session.sessionId}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-red-500/10 hover:text-red-400 text-slate-600 disabled:opacity-40"
                    title="刪除對話"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <ChevronRight className="w-4 h-4 text-slate-700 group-hover:text-slate-400 transition-colors" />
                </div>
              </div>

              {/* Preview */}
              <p className="text-sm text-slate-300 leading-relaxed line-clamp-2 group-hover:text-slate-200 transition-colors mb-4">
                {session.preview || <span className="italic text-slate-600">No messages</span>}
              </p>

              {/* Divider + rule badge */}
              <div className="border-t border-slate-800 pt-4 flex items-center justify-between">
                <span className="text-xs text-slate-600 uppercase tracking-wide font-medium">監控規則</span>

                {session.rule ? (
                  <span className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border font-medium ${
                    session.rule.isActive
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                      : 'bg-slate-800 text-slate-500 border-slate-700'
                  }`}>
                    {session.rule.poolType === 'DYNAMIC'
                      ? <Database className="w-3 h-3" />
                      : <Zap className="w-3 h-3" />
                    }
                    {session.rule.name}
                    {!session.rule.isActive && (
                      <span className="ml-0.5 text-slate-600">· 未啟用</span>
                    )}
                  </span>
                ) : (
                  <span className="text-xs text-slate-700 italic">尚未建立規則</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Chat session view (shown when ?session= is in URL) ───────────────────────

function ChatSession({ sessionId }: { sessionId: string }) {
  const router = useRouter();

  const wasResumingRef = useRef(true); // always true — session ID is always in URL now
  const urlPublishedRef = useRef(true); // session ID is already in the URL

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingRule, setPendingRule] = useState<RulePayload['rule'] | null>(null);
  const [editingCode, setEditingCode] = useState<string>('');
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (historyLoaded) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, historyLoaded]);

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

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: userMsg },
      { role: 'assistant', content: '', streaming: true },
    ]);

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      const res = await fetch(`${BASE}/chat/${sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message: userMsg }),
      });

      if (!res.ok) {
        let msg = '抱歉，發生錯誤，請稍後再試。';
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch { /* non-JSON error body */ }
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last?.streaming) return prev;
          return [...prev.slice(0, -1), { ...last, content: msg, streaming: false }];
        });
        return;
      }

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
    } catch (err) {
      let msg = '儲存規則失敗，請稍後再試';
      if (err instanceof Error) {
        try {
          const jsonPart = err.message.slice(err.message.indexOf('{'));
          const body = JSON.parse(jsonPart);
          if (body?.error) msg = body.error;
        } catch { /* non-JSON error body — keep default message */ }
      }
      alert(msg);
    }
  };

  const clearChat = async () => {
    await api.clearChat(sessionId);
    setPendingRule(null);
    setMessages([{ role: 'assistant', content: '對話已清除。請告訴我您想設定什麼股票監控規則？' }]);
    router.replace('/chat');
  };

  if (!historyLoaded) {
    return (
      <div className="flex items-center justify-center flex-1 text-slate-500 text-sm">
        載入對話中…
      </div>
    );
  }

  // Suppress unused-ref lint warning — refs are intentionally kept for future use
  void wasResumingRef; void urlPublishedRef;

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Header */}
      <div className="border-b border-slate-800 px-4 py-3 flex items-center gap-3">
        <Link href="/chat" className="btn-ghost p-1.5 rounded-lg" title="Back to history">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <h1 className="font-semibold text-slate-100 text-sm">AI 助手對話</h1>
          <p className="text-xs text-slate-500">{sessionId}</p>
        </div>
        <button onClick={clearChat} className="btn-ghost text-xs flex items-center gap-1.5">
          <Trash2 className="w-3.5 h-3.5" />
          清除
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
              <p className="text-sm font-medium text-emerald-400 mb-0.5">規則準備儲存：{pendingRule.name}</p>
              <p className="text-xs text-slate-400">{pendingRule.description}</p>
              {(pendingRule.poolType ?? 'FIXED') === 'DYNAMIC' ? (
                <p className="text-xs text-purple-400 mt-0.5">
                  動態選股池 — <code className="font-mono">{pendingRule.poolFilterCode}</code>
                </p>
              ) : (
                <p className="text-xs text-slate-500 mt-0.5">股票代號：{pendingRule.symbols.join(', ')}</p>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={saveRule} className="btn-primary text-xs flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                儲存規則
              </button>
              <button onClick={() => setPendingRule(null)} className="btn-ghost text-xs">
                取消
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
            placeholder={loading ? '等待 AI 回覆中…' : '描述您的股票監控策略…'}
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

// ─── Root — switches between history list and chat session ────────────────────

function ChatRoot() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');

  if (sessionId) return <ChatSession sessionId={sessionId} />;
  return <ChatHistoryList />;
}

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center flex-1 text-slate-500 text-sm">載入中…</div>
    }>
      <ChatRoot />
    </Suspense>
  );
}
