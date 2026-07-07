'use client';

import { useState, useEffect, useRef } from 'react';
import { ChevronRight, Copy, Check, Lock, Radio, Code2, BookOpen } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Section {
  id: string;
  label: string;
  icon?: React.ReactNode;
  children?: { id: string; label: string }[];
}

// ─── Sidebar config ───────────────────────────────────────────────────────────
const sections: Section[] = [
  { id: 'overview', label: '概覽', icon: <BookOpen className="w-4 h-4" /> },
  { id: 'auth', label: '身份驗證', icon: <Lock className="w-4 h-4" />, children: [
    { id: 'auth-login', label: '登入' },
  ]},
  { id: 'websocket', label: 'WebSocket API', icon: <Radio className="w-4 h-4" />, children: [
    { id: 'ws-connect', label: '建立連線' },
    { id: 'ws-events', label: '接收通知' },
  ]},
];

// ─── Code block component ──────────────────────────────────────────────────────
function CodeBlock({ code, language = 'http' }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group rounded-lg bg-slate-950 border border-slate-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800">
        <span className="text-xs text-slate-500 font-mono">{language}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? '已複製' : '複製'}
        </button>
      </div>
      <pre className="p-4 text-sm text-slate-300 font-mono overflow-x-auto leading-relaxed whitespace-pre">{code}</pre>
    </div>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────
const methodColors: Record<string, string> = {
  GET: 'bg-sky-600/20 text-sky-400 border-sky-600/30',
  POST: 'bg-green-600/20 text-green-400 border-green-600/30',
  PATCH: 'bg-amber-600/20 text-amber-400 border-amber-600/30',
  DELETE: 'bg-red-600/20 text-red-400 border-red-600/30',
  WS: 'bg-purple-600/20 text-purple-400 border-purple-600/30',
};

function MethodBadge({ method }: { method: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold border ${methodColors[method] ?? 'bg-slate-700 text-slate-300'}`}>
      {method}
    </span>
  );
}

// ─── Endpoint section ─────────────────────────────────────────────────────────
function Endpoint({
  id, method, path, title, description, auth = true, request, response,
}: {
  id: string; method: string; path: string; title: string; description?: string;
  auth?: boolean; request?: string; response?: string;
}) {
  return (
    <div id={id} className="scroll-mt-20 border border-slate-800 rounded-xl overflow-hidden bg-slate-900/40">
      <div className="px-5 py-4 border-b border-slate-800 flex items-start gap-3 flex-wrap">
        <MethodBadge method={method} />
        <code className="font-mono text-sm text-slate-200 flex-1">{path}</code>
        {auth && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-400 bg-amber-900/20 border border-amber-700/30 rounded px-2 py-0.5">
            <Lock className="w-3 h-3" /> 需要認證
          </span>
        )}
      </div>
      <div className="p-5 space-y-4">
        <div>
          <h4 className="font-semibold text-slate-100">{title}</h4>
          {description && <p className="text-sm text-slate-400 mt-1">{description}</p>}
        </div>
        {request && (
          <div>
            <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider">Request</p>
            <CodeBlock code={request} language="json" />
          </div>
        )}
        {response && (
          <div>
            <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider">Response</p>
            <CodeBlock code={response} language="json" />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section heading ──────────────────────────────────────────────────────────
function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-20 text-xl font-bold text-slate-100 mt-12 mb-6 flex items-center gap-2 border-b border-slate-800 pb-3">
      {children}
    </h2>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-slate-300 mt-8 mb-3">{children}</h3>;
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DocsPage() {
  const [activeId, setActiveId] = useState('overview');
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const allIds = sections.flatMap((s) => [s.id, ...(s.children?.map((c) => c.id) ?? [])]);
    const elements = allIds.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    elements.forEach((el) => observerRef.current!.observe(el));
    return () => observerRef.current?.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-slate-800 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto py-6 px-4">
        <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-4 px-2">目錄</p>
        <nav className="space-y-0.5">
          {sections.map((section) => (
            <div key={section.id}>
              <button
                onClick={() => scrollTo(section.id)}
                className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-left transition-colors ${
                  activeId === section.id
                    ? 'bg-sky-600/15 text-sky-400'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                {section.icon}
                <span className="font-medium">{section.label}</span>
              </button>
              {section.children && (
                <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-800 pl-3">
                  {section.children.map((child) => (
                    <button
                      key={child.id}
                      onClick={() => scrollTo(child.id)}
                      className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-left transition-colors ${
                        activeId === child.id
                          ? 'text-sky-400'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      <ChevronRight className="w-3 h-3 shrink-0" />
                      {child.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 max-w-3xl mx-auto px-6 py-8 pb-24">

        {/* Header */}
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 text-xs text-sky-400 bg-sky-900/20 border border-sky-700/30 rounded-full px-3 py-1 mb-4">
            <Code2 className="w-3.5 h-3.5" /> API 文件
          </div>
          <h1 className="text-3xl font-bold text-slate-100">AI股探 API 文件</h1>
          <p className="text-slate-400 mt-2">開放給外部程式直接呼叫的介面，僅有登入與 WebSocket 通知兩項。</p>
        </div>

        {/* Base URL box */}
        <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 mb-8 flex items-center gap-3">
          <span className="text-xs text-slate-500 shrink-0">Base URL</span>
          <code className="font-mono text-sky-300 text-sm">http://localhost:3001</code>
        </div>

        {/* ── Overview ── */}
        <SectionHeading id="overview"><BookOpen className="w-5 h-5 text-sky-400" /> 概覽</SectionHeading>
        <div className="prose-custom space-y-4 text-slate-400 text-sm leading-relaxed">
          <p>AI股探對外開放的使用者介面只有兩項：</p>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { icon: <Lock className="w-5 h-5 text-sky-400" />, title: '登入', desc: '呼叫登入端點取得 JWT Token，用於建立 WebSocket 連線。' },
              { icon: <Radio className="w-5 h-5 text-purple-400" />, title: 'WebSocket 通知', desc: '帶入登入取得的 JWT Token 建立 Socket.IO 連線，接收屬於你帳號的規則觸發通知。' },
            ].map((item) => (
              <div key={item.title} className="border border-slate-800 rounded-lg p-4 bg-slate-900/40">
                <div className="flex items-center gap-2 mb-2">{item.icon}<span className="font-semibold text-slate-200">{item.title}</span></div>
                <p className="text-xs">{item.desc}</p>
              </div>
            ))}
          </div>

          <p>
            規則管理、帳號設定、通知管道綁定、AI 對話等其他功能，仍由伺服器提供並持續運作，但僅供官方網站的儀表板本身呼叫使用，
            不開放作為外部程式可直接呼叫的公開 API。
          </p>

          <SubHeading>認證方式</SubHeading>
          <p>先呼叫登入端點取得 JWT Token，再將 Token 帶入 WebSocket 連線的認證欄位：</p>
          <CodeBlock code={`Authorization: Bearer <你的 JWT Token>`} language="http" />

          <SubHeading>錯誤格式</SubHeading>
          <p>所有錯誤回應均使用以下格式，HTTP 狀態碼反映錯誤類型（400、401、403、404、409、500）：</p>
          <CodeBlock code={`{ "error": "錯誤描述訊息" }`} language="json" />
        </div>

        {/* ── Auth ── */}
        <SectionHeading id="auth"><Lock className="w-5 h-5 text-sky-400" /> 身份驗證</SectionHeading>

        <Endpoint
          id="auth-login"
          method="POST"
          path="/api/auth/login"
          title="登入"
          description="驗證帳號密碼，回傳有效期 7 天的 JWT Token。此 Token 用於建立 WebSocket 連線以接收通知。"
          auth={false}
          request={`{
  "username": "myuser",
  "password": "mypass123"
}`}
          response={`{
  "token": "eyJhbGci...",
  "user": {
    "id": "clxxxxxxxx",
    "username": "myuser"
  }
}`}
        />

        {/* ── WebSocket ── */}
        <SectionHeading id="websocket"><Radio className="w-5 h-5 text-sky-400" /> WebSocket API</SectionHeading>
        <p className="text-slate-400 text-sm mb-6">使用 <a href="https://socket.io/docs/v4/client-installation/" className="text-sky-400 underline underline-offset-2" target="_blank" rel="noreferrer">Socket.IO v4 客戶端</a>連線。必須在連線時帶入登入取得的 JWT Token，否則連線會被拒絕。</p>

        <div id="ws-connect" className="scroll-mt-20 border border-slate-800 rounded-xl overflow-hidden bg-slate-900/40 mb-4">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center gap-3">
            <MethodBadge method="WS" />
            <code className="font-mono text-sm text-slate-200">ws://localhost:3001</code>
          </div>
          <div className="p-5 space-y-4">
            <h4 className="font-semibold text-slate-100">建立連線</h4>
            <p className="text-sm text-slate-400">Token 驗證成功後自動加入 <code className="text-sky-300 bg-slate-800 px-1 rounded text-xs">user:&lt;id&gt;</code> 房間，即可接收 <code className="text-sky-300 bg-slate-800 px-1 rounded text-xs">notification</code> 事件。缺少或無效的 Token 會導致連線被拒絕。</p>

            <div>
              <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider">JavaScript / TypeScript</p>
              <CodeBlock language="typescript" code={`import { io } from 'socket.io-client';

const TOKEN = 'eyJhbGci...'; // 登入取得的 JWT Token

const socket = io('http://localhost:3001', {
  auth: { token: \`Bearer \${TOKEN}\` },
  transports: ['websocket'],
});

socket.on('connect', () => {
  console.log('已連線，Socket ID:', socket.id);
});

socket.on('connect_error', (err) => {
  console.error('連線失敗（Token 缺失或無效）:', err.message);
});`} />
            </div>

            <div>
              <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider">Python</p>
              <CodeBlock language="python" code={`import socketio

sio = socketio.Client()
TOKEN = 'eyJhbGci...'

@sio.event
def connect():
    print('已連線')

sio.connect(
    'http://localhost:3001',
    auth={'token': f'Bearer {TOKEN}'},
    transports=['websocket']
)
sio.wait()`} />
            </div>
          </div>
        </div>

        <div id="ws-events" className="scroll-mt-20 border border-slate-800 rounded-xl overflow-hidden bg-slate-900/40">
          <div className="px-5 py-4 border-b border-slate-800">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold border bg-sky-700/30 text-sky-300 border-sky-600">ON</span>
            <span className="ml-3 font-mono text-sm text-slate-200">接收通知</span>
          </div>
          <div className="p-5 space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <code className="text-sky-400 font-mono text-sm bg-slate-800 px-2 py-0.5 rounded">notification</code>
                <span className="inline-flex items-center gap-1 text-xs text-amber-400 bg-amber-900/20 border border-amber-700/30 rounded px-1.5 py-0.5"><Lock className="w-3 h-3" /> 需要 JWT 認證</span>
              </div>
              <p className="text-sm text-slate-400 mb-3">屬於你帳號的規則觸發通知，只有你能收到。</p>
              <CodeBlock language="typescript" code={`socket.on('notification', (data) => {
  /*
  {
    ruleId:      "clxxxxxxxx",
    ruleName:    "台積電突破均線",
    triggerId:   "clxxxxxxxx",
    symbol:      "2330",
    signal:      "BUY",
    price:       920,
    message:     "2330 股價突破20日均線",
    triggeredAt: "2026-07-01T10:30:00Z"
  }
  */
  console.log(\`訊號：\${data.signal} \${data.symbol} @ \${data.price}\`);
});`} />
            </div>
          </div>
        </div>

        {/* Event table */}
        <div className="mt-8 rounded-xl border border-slate-800 overflow-hidden">
          <div className="px-5 py-3 bg-slate-900 border-b border-slate-800">
            <p className="text-sm font-semibold text-slate-300">事件一覽表</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/50">
                <th className="text-left px-5 py-2.5 text-xs text-slate-500 font-medium w-32">事件名稱</th>
                <th className="text-left px-4 py-2.5 text-xs text-slate-500 font-medium w-20">方向</th>
                <th className="text-left px-4 py-2.5 text-xs text-slate-500 font-medium">說明</th>
                <th className="text-left px-4 py-2.5 text-xs text-slate-500 font-medium w-24">是否需認證</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {[
                { name: 'notification', dir: '接收', desc: '帳號專屬規則觸發通知', needsAuth: '是' },
              ].map((row) => (
                <tr key={row.name} className="hover:bg-slate-900/40 transition-colors">
                  <td className="px-5 py-3"><code className="text-sky-300 font-mono text-xs">{row.name}</code></td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{row.dir}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{row.desc}</td>
                  <td className="px-4 py-3 text-xs">
                    {row.needsAuth === '是'
                      ? <span className="text-amber-400">是</span>
                      : <span className="text-slate-500">否</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer note */}
        <p className="text-center text-xs text-slate-600 mt-16">AI股探 API · Base URL: <code className="text-slate-500">http://localhost:3001</code></p>
      </div>
    </div>
  );
}
