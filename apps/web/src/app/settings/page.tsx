'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Mail, MessageSquare, Disc, Save, CheckCircle, XCircle, Send } from 'lucide-react';

interface Settings {
  email: string | null;
  lineToken: string | null;
  discordWebhook: string | null;
}

type Channel = 'email' | 'line' | 'discord';

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({ email: null, lineToken: null, discordWebhook: null });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState<Channel | null>(null);
  const [testResult, setTestResult] = useState<Record<Channel, 'ok' | 'error' | null>>({
    email: null, line: null, discord: null,
  });

  useEffect(() => {
    api.getSettings().then((s) => setSettings(s as Settings)).catch(console.error);
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateSettings(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const test = async (channel: Channel) => {
    setTesting(channel);
    try {
      await api.testNotification(channel);
      setTestResult((prev) => ({ ...prev, [channel]: 'ok' }));
    } catch {
      setTestResult((prev) => ({ ...prev, [channel]: 'error' }));
    } finally {
      setTesting(null);
      setTimeout(() => setTestResult((prev) => ({ ...prev, [channel]: null })), 5000);
    }
  };

  const channels = [
    {
      key: 'email' as Channel,
      label: 'Email',
      icon: Mail,
      color: 'text-blue-400',
      placeholder: 'your@email.com',
      value: settings.email || '',
      onChange: (v: string) => setSettings((p) => ({ ...p, email: v || null })),
      hint: 'Uses SMTP configured in server environment variables.',
    },
    {
      key: 'line' as Channel,
      label: 'LINE Notify',
      icon: MessageSquare,
      color: 'text-green-400',
      placeholder: 'notify:YOUR_LINE_NOTIFY_TOKEN',
      value: settings.lineToken || '',
      onChange: (v: string) => setSettings((p) => ({ ...p, lineToken: v || null })),
      hint: 'Get a token from notify-bot.line.me. Prefix with "notify:" for LINE Notify, or enter a LINE user ID for Messaging API.',
    },
    {
      key: 'discord' as Channel,
      label: 'Discord',
      icon: Disc,
      color: 'text-indigo-400',
      placeholder: 'https://discord.com/api/webhooks/...',
      value: settings.discordWebhook || '',
      onChange: (v: string) => setSettings((p) => ({ ...p, discordWebhook: v || null })),
      hint: 'Create a webhook in your Discord server settings → Integrations → Webhooks.',
    },
  ];

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-slate-100 mb-1">Notification Settings</h1>
        <p className="text-sm text-slate-400">Configure how you receive stock signal alerts.</p>
      </div>

      <div className="space-y-4">
        {channels.map((ch) => {
          const Icon = ch.icon;
          const result = testResult[ch.key];

          return (
            <div key={ch.key} className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <Icon className={`w-4 h-4 ${ch.color}`} />
                <h3 className="font-medium text-slate-200">{ch.label}</h3>
              </div>

              <div className="flex gap-2">
                <input
                  className="input"
                  placeholder={ch.placeholder}
                  value={ch.value}
                  onChange={(e) => ch.onChange(e.target.value)}
                  type={ch.key === 'email' ? 'email' : 'text'}
                />
                <button
                  onClick={() => test(ch.key)}
                  disabled={!ch.value || testing === ch.key}
                  className="btn-ghost flex items-center gap-1.5 text-sm flex-shrink-0"
                >
                  {testing === ch.key ? (
                    <Send className="w-4 h-4 animate-pulse" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Test
                </button>
              </div>

              {result && (
                <div className={`flex items-center gap-1.5 mt-2 text-xs ${result === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {result === 'ok' ? (
                    <><CheckCircle className="w-3.5 h-3.5" /> Test notification sent!</>
                  ) : (
                    <><XCircle className="w-3.5 h-3.5" /> Failed — check your credentials and server config.</>
                  )}
                </div>
              )}

              <p className="text-xs text-slate-500 mt-2">{ch.hint}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={save}
          disabled={saving}
          className="btn-primary flex items-center gap-2"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Settings'}
        </button>

        {saved && (
          <div className="flex items-center gap-1.5 text-emerald-400 text-sm">
            <CheckCircle className="w-4 h-4" />
            Saved!
          </div>
        )}
      </div>

      {/* API Keys Info */}
      <div className="mt-8 card p-5 border-amber-500/20 bg-amber-500/5">
        <h3 className="text-sm font-medium text-amber-400 mb-2">Server Configuration Required</h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          Copy <code className="bg-slate-800 px-1 rounded">.env.example</code> to <code className="bg-slate-800 px-1 rounded">.env</code> in <code className="bg-slate-800 px-1 rounded">apps/api/</code> and fill in your API keys:
        </p>
        <ul className="mt-2 space-y-1 text-xs text-slate-500">
          <li>• <strong className="text-slate-400">FUGLE_API_KEY</strong> — for real-time Taiwan stock data</li>
          <li>• <strong className="text-slate-400">OPENROUTER_API_KEY</strong> — for AI Agent</li>
          <li>• <strong className="text-slate-400">SMTP_*</strong> — for email notifications</li>
          <li>• <strong className="text-slate-400">LINE_CHANNEL_ACCESS_TOKEN</strong> — for LINE Messaging API</li>
        </ul>
      </div>
    </div>
  );
}
