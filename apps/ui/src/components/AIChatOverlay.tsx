import React, { useState, useEffect, useRef } from 'react';
import {
  Bot,
  Sparkles,
  X,
  Maximize2,
  Minimize2,
  RotateCcw,
  Send,
  Cpu,
  HardDrive,
  Activity,
  Layers,
  AlertCircle,
  Copy,
  Check,
  Zap,
  Clock,
  ShieldCheck,
  ChevronRight,
  Database,
  Sliders,
  User,
  Terminal,
  Boxes,
  RotateCw,
} from 'lucide-react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolData?: any;
  model?: string;
  hardware?: string;
}

const DEFAULT_SUGGESTIONS = [
  'Can you restart the keycloak-operator deployment for me?',
  'How many pods are running across the cluster?',
  'What is the average CPU usage of namespace alpha for the past 10 hours?',
  'Show cluster capacity and resource headroom',
  'Scan for warning events or crashloops',
  'List all virtual clusters and their Istio status',
];

export default function AIChatOverlay() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ online: boolean; model: string; hardware: string }>({
    online: true,
    model: 'Gemma 3 1B (Q4)',
    hardware: 'RTX 4090 (CUDA)',
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Poll status on mount
  useEffect(() => {
    fetch('/api/ai/status')
      .then((res) => res.json())
      .then((data) => {
        if (data?.ai) {
          setStatus({
            online: data.ai.online,
            model: data.ai.model || 'Gemma 3 1B (Q4)',
            hardware: data.ai.hardware || 'RTX 4090 (CUDA)',
          });
        }
      })
      .catch(() => {});
  }, []);

  // Keyboard shortcut Ctrl+/ or Cmd+/ to toggle overlay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleSendMessage = async (customText?: string) => {
    const text = (customText || inputPrompt).trim();
    if (!text || loading) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputPrompt('');
    setLoading(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();

      const assistantMessage: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: data.content || 'Analysis complete.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        toolData: data.toolData,
        model: data.model || status.model,
        hardware: data.hardware || status.hardware,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: any) {
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Error contacting local AI engine: ${err.message}. Please verify the cluster database and AI service are reachable.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleClear = () => {
    setMessages([]);
  };

  const parseBoldAndCode = (str: string) => {
    const parts = str.split(/(\*\*.*?\*\*|`.*?`)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={i} className="font-semibold text-white">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code key={i} className="px-1.5 py-0.5 bg-cyber-950/90 border border-cyber-700/80 rounded text-cyan-300 font-mono text-xs shadow-inner">
            {part.slice(1, -1)}
          </code>
        );
      }
      return part;
    });
  };

  const renderTextLines = (chunk: string) => {
    const lines = chunk.split('\n');
    return lines.map((line, idx) => {
      // 1. Status Badges: [STATUS: ...], [TELEMETRY: ...], [ALERT: ...]
      const badgeMatch = line.trim().match(/^\[(STATUS|TELEMETRY|ALERT|DIAGNOSTIC):\s*([^\]]+)\]/i);
      if (badgeMatch) {
        const tag = `${badgeMatch[1]}: ${badgeMatch[2]}`;
        const isOptimal = /optimal|green|stable|verified|active/i.test(tag);
        const isWarning = /attention|warn|alert|critical|zero|pressure/i.test(tag);
        return (
          <div key={idx} className="my-1.5">
            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-semibold tracking-wide shadow-sm border ${
                isOptimal
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300 shadow-emerald-500/10'
                  : isWarning
                  ? 'bg-amber-950/60 border-amber-500/40 text-amber-300 shadow-amber-500/10'
                  : 'bg-cyan-950/60 border-cyan-500/40 text-cyan-300 shadow-cyan-500/10'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                  isOptimal ? 'bg-emerald-400' : isWarning ? 'bg-amber-400' : 'bg-cyan-400'
                }`}
              />
              <span>{tag}</span>
            </div>
          </div>
        );
      }

      // 2. Blockquotes (> ...)
      if (line.trim().startsWith('> ')) {
        const quoteContent = line.trim().replace(/^>\s*/, '');
        return (
          <div key={idx} className="my-2 border-l-2 border-cyan-400 bg-cyan-950/30 px-3 py-2 rounded-r-xl text-slate-300 text-xs italic">
            {parseBoldAndCode(quoteContent)}
          </div>
        );
      }

      // 3. Section Headers (### ...)
      if (line.trim().startsWith('### ')) {
        const title = line.trim().replace(/^###\s*/, '');
        return (
          <h4 key={idx} className="text-sm font-bold bg-gradient-to-r from-cyan-300 via-blue-200 to-indigo-200 bg-clip-text text-transparent mt-3.5 mb-1.5 flex items-center gap-1.5 tracking-wide">
            <ChevronRight className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span>{title}</span>
          </h4>
        );
      }

      // 4. Bullet list items (- ... or * ...)
      if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        const itemContent = line.trim().replace(/^[-*]\s*/, '');
        return (
          <div key={idx} className="flex items-start gap-2 pl-1.5 my-1">
            <span className="text-cyan-400 text-[10px] mt-1 shrink-0">◆</span>
            <div className="flex-1 text-slate-200">{parseBoldAndCode(itemContent)}</div>
          </div>
        );
      }

      // 5. Empty spacer
      if (line.trim() === '') {
        return <div key={idx} className="h-1" />;
      }

      // 6. Regular paragraph
      return (
        <p key={idx} className="leading-relaxed">
          {parseBoldAndCode(line)}
        </p>
      );
    });
  };

  // Rich markdown parser supporting code blocks, quotes, badges, headers, and lists
  const renderRichMarkdown = (text: string) => {
    const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
    const elements: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let segmentIndex = 0;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        const textChunk = text.slice(lastIndex, match.index);
        elements.push(
          <div key={`text-${segmentIndex++}`}>
            {renderTextLines(textChunk)}
          </div>
        );
      }

      const lang = match[1] || 'bash';
      const code = match[2];
      elements.push(
        <div key={`code-${segmentIndex++}`} className="my-3 rounded-xl border border-cyber-800/90 bg-cyber-950 shadow-lg overflow-hidden group">
          <div className="flex items-center justify-between px-3 py-1.5 bg-cyber-900/90 border-b border-cyber-800/70 text-[11px] font-mono text-slate-400">
            <span className="flex items-center gap-1.5 text-cyan-400">
              <Terminal className="w-3.5 h-3.5" />
              <span className="uppercase text-[10px] font-bold tracking-wider">{lang}</span>
            </span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(code.trim());
                setCopiedId(`code-${segmentIndex}`);
                setTimeout(() => setCopiedId(null), 2000);
              }}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition-colors px-2 py-0.5 rounded bg-cyber-900 hover:bg-cyber-800 border border-cyber-800/60"
            >
              {copiedId === `code-${segmentIndex}` ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
          <pre className="p-3 text-xs font-mono text-cyan-200 overflow-x-auto whitespace-pre selection:bg-cyan-500/30 leading-relaxed">
            <code>{code.trim()}</code>
          </pre>
        </div>
      );

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      const textChunk = text.slice(lastIndex);
      elements.push(
        <div key={`text-${segmentIndex++}`}>
          {renderTextLines(textChunk)}
        </div>
      );
    }

    return <div className="space-y-2 text-sm leading-relaxed text-slate-200">{elements}</div>;
  };

  return (
    <>
      {/* Floating Bottom-Right Launcher Trigger */}
      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3">
        {!isOpen && (
          <div
            onClick={() => setIsOpen(true)}
            className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-cyber-900/90 backdrop-blur-md border border-cyan-500/30 rounded-full text-xs font-medium text-slate-300 shadow-xl cursor-pointer hover:border-cyan-400/60 transition-all hover:scale-105 group"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Gemma 3 Copilot</span>
            <kbd className="px-1.5 py-0.5 bg-cyber-800 text-[10px] font-mono text-cyan-300 rounded border border-cyber-700/60">
              Ctrl+/
            </kbd>
          </div>
        )}

        <button
          onClick={() => setIsOpen(!isOpen)}
          aria-label={isOpen ? 'Close AI Chat' : 'Open AI Chat'}
          className={`relative p-3.5 rounded-full shadow-2xl transition-all duration-300 transform hover:scale-110 active:scale-95 flex items-center justify-center ${
            isOpen
              ? 'bg-cyber-800 text-slate-200 border border-cyber-700 hover:bg-cyber-700'
              : 'bg-gradient-to-tr from-cyan-600 via-blue-600 to-purple-600 text-white shadow-cyan-500/25 ring-2 ring-cyan-400/40'
          }`}
        >
          {isOpen ? (
            <X className="w-6 h-6" />
          ) : (
            <>
              <Sparkles className="w-6 h-6 animate-pulse" />
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-cyber-950"></span>
            </>
          )}
        </button>
      </div>

      {/* Floating Chat Overlay Panel */}
      {isOpen && (
        <div
          className={`fixed bottom-24 right-6 z-50 bg-cyber-950/95 backdrop-blur-2xl border border-cyber-800/90 shadow-2xl rounded-2xl flex flex-col overflow-hidden transition-all duration-300 ${
            isExpanded
              ? 'w-[760px] max-w-[calc(100vw-3rem)] h-[750px] max-h-[calc(100vh-8rem)]'
              : 'w-[480px] max-w-[calc(100vw-3rem)] h-[640px] max-h-[calc(100vh-8rem)]'
          }`}
        >
          {/* Header */}
          <div className="px-4 py-3.5 bg-cyber-900/80 border-b border-cyber-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/20">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-white tracking-wide">vCOp AI Copilot</h3>
                  <span className="px-1.5 py-0.5 bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-mono text-emerald-400 rounded">
                    Online
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5 mt-0.5">
                  <Zap className="w-3 h-3 text-cyan-400" />
                  <span>{status.model}</span>
                  <span className="text-slate-600">•</span>
                  <span className="text-cyan-400">{status.hardware}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={handleClear}
                title="Clear conversation"
                className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-cyber-800 rounded-lg transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                title={isExpanded ? 'Minimize' : 'Expand'}
                className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-cyber-800 rounded-lg transition-colors"
              >
                {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                title="Close"
                className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-cyber-800 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Chat Messages List */}
          <div className="flex-1 p-4 overflow-y-auto overflow-x-hidden space-y-4">
            {messages.length === 0 && (
              <div className="h-full flex flex-col justify-center items-center text-center px-4 py-8">
                <div className="w-14 h-14 rounded-2xl bg-cyber-900 border border-cyber-700/80 flex items-center justify-center text-cyan-400 mb-4 shadow-xl">
                  <Sparkles className="w-7 h-7" />
                </div>
                <h4 className="text-base font-semibold text-white mb-1">How can I assist your cluster today?</h4>
                <p className="text-xs text-slate-400 max-w-sm mb-6">
                  Powered by bundled <strong className="text-cyan-300">Gemma 3</strong> on local GPU. Ask about historical CPU/memory stats, capacity, virtual clusters, and events.
                </p>

                <div className="w-full space-y-2 text-left">
                  <span className="text-[11px] font-mono text-slate-500 uppercase tracking-wider block mb-2 px-1">
                    Suggested Inquiries:
                  </span>
                  {DEFAULT_SUGGESTIONS.map((suggestion, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSendMessage(suggestion)}
                      className="w-full text-xs text-slate-300 bg-cyber-900/60 hover:bg-cyber-800/80 border border-cyber-800 hover:border-cyan-500/40 p-2.5 rounded-xl transition-all flex items-center justify-between group text-left"
                    >
                      <span className="text-slate-200 group-hover:text-cyan-300 transition-colors pr-2 break-words">
                        {suggestion}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all shrink-0 ml-1" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} w-full animate-in fade-in duration-300`}
              >
                {/* Message Header with Avatars */}
                {msg.role === 'assistant' ? (
                  <div className="flex items-center gap-2 mb-1.5 px-1">
                    <div className="w-5 h-5 rounded-lg bg-gradient-to-tr from-cyan-500 via-blue-600 to-purple-600 flex items-center justify-center text-white shadow-sm shadow-cyan-500/25">
                      <Sparkles className="w-3 h-3" />
                    </div>
                    <span className="text-xs font-semibold text-slate-200">vCOp Copilot</span>
                    <span className="text-[10px] font-mono text-cyan-300 px-1.5 py-0.5 bg-cyan-950/70 border border-cyan-500/30 rounded-md">
                      Gemma 3 1B
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono ml-auto">{msg.timestamp}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 mb-1 px-1 justify-end">
                    <span className="text-[10px] text-slate-500 font-mono mr-1">{msg.timestamp}</span>
                    <span className="text-xs font-semibold text-slate-300">Operator</span>
                    <div className="w-5 h-5 rounded-lg bg-cyber-800 border border-cyber-700 flex items-center justify-center text-cyan-300 shadow-sm">
                      <User className="w-3 h-3" />
                    </div>
                  </div>
                )}

                {/* Message Bubble Container */}
                <div
                  className={`transition-all ${
                    msg.role === 'user'
                      ? 'max-w-[85%] bg-gradient-to-br from-cyan-600 to-blue-600 text-white rounded-2xl rounded-tr-none p-3.5 shadow-lg shadow-cyan-600/10 text-sm leading-relaxed font-medium'
                      : 'w-full bg-cyber-900/90 border border-cyber-800/90 text-slate-200 rounded-2xl rounded-tl-none p-4 shadow-xl backdrop-blur-md'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <p className="text-sm font-medium leading-relaxed">{msg.content}</p>
                  ) : (
                    <div className="space-y-3">
                      {/* Rich Markdown Output */}
                      {renderRichMarkdown(msg.content)}

                      {/* Rich Metric Cards Widget */}
                      {msg.toolData?.type === 'metrics' && msg.toolData.metrics && (
                        <div className="mt-3 pt-3 border-t border-cyber-800/80 space-y-2.5">
                          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                            <span className="flex items-center gap-1 text-cyan-300">
                              <Activity className="w-3.5 h-3.5" />
                              Telemetry Window: {msg.toolData.metrics.timeWindow}
                            </span>
                            <span>{msg.toolData.metrics.sampleCount.toLocaleString()} samples</span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {msg.toolData.metrics.cards.map((card: any, cIdx: number) => (
                              <div
                                key={cIdx}
                                className="bg-cyber-950/70 border border-cyber-800/80 p-2.5 rounded-xl flex flex-col justify-between hover:border-cyan-500/30 transition-colors"
                              >
                                <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider truncate">
                                  {card.title}
                                </span>
                                <div className="text-base font-bold text-white font-mono mt-1">
                                  {card.value}
                                </div>
                                <span className="text-[10px] text-slate-500 font-mono truncate mt-0.5">
                                  {card.subtext}
                                </span>
                              </div>
                            ))}
                          </div>

                          {/* Workloads breakdown if present */}
                          {msg.toolData.metrics.workloads && msg.toolData.metrics.workloads.length > 0 && (
                            <div className="bg-cyber-950/60 border border-cyber-800/60 rounded-xl p-2.5 overflow-hidden">
                              <span className="text-[11px] font-semibold text-slate-300 block mb-1.5">
                                Workload Distribution:
                              </span>
                              <table className="w-full text-left text-xs font-mono">
                                <thead>
                                  <tr className="text-slate-500 border-b border-cyber-800 text-[10px]">
                                    <th className="pb-1">Workload</th>
                                    <th className="pb-1">Avg CPU</th>
                                    <th className="pb-1">Peak CPU</th>
                                    <th className="pb-1">Avg RAM</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-cyber-900/60">
                                  {msg.toolData.metrics.workloads.map((wl: any, wIdx: number) => (
                                    <tr key={wIdx} className="hover:bg-cyber-900/30">
                                      <td className="py-1 text-slate-300 font-medium truncate max-w-[140px]">
                                        {wl.name}
                                      </td>
                                      <td className="py-1 text-cyan-300">{wl.avgCpu}</td>
                                      <td className="py-1 text-slate-400">{wl.peakCpu}</td>
                                      <td className="py-1 text-slate-400">{wl.avgMem}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Rich Capacity Widget with Visual Headroom Progress Bars */}
                      {msg.toolData?.type === 'capacity' && msg.toolData.capacity && (
                        <div className="mt-3 pt-3 border-t border-cyber-800/80 space-y-2.5 font-mono">
                          <div className="flex items-center justify-between text-xs text-slate-400">
                            <span className="flex items-center gap-1.5 text-cyan-300 font-medium">
                              <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                              Physical Compute Headroom
                            </span>
                            <span className="text-[10px] text-slate-500">{msg.toolData.capacity.nodes} host node(s)</span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                            {/* CPU Card */}
                            <div className="bg-cyber-950/80 border border-cyber-800 p-3 rounded-xl">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-slate-400 text-[11px] uppercase tracking-wider">CPU Headroom</span>
                                <span className={`text-sm font-bold ${msg.toolData.capacity.headroomCpuPct >= 40 ? 'text-emerald-400' : msg.toolData.capacity.headroomCpuPct >= 20 ? 'text-amber-400' : 'text-rose-400'}`}>
                                  {msg.toolData.capacity.headroomCpuPct}% Free
                                </span>
                              </div>
                              <div className="w-full bg-cyber-900 rounded-full h-2 my-2 overflow-hidden border border-cyber-800">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${msg.toolData.capacity.headroomCpuPct >= 40 ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : msg.toolData.capacity.headroomCpuPct >= 20 ? 'bg-gradient-to-r from-amber-500 to-yellow-400' : 'bg-gradient-to-r from-rose-500 to-red-400'}`}
                                  style={{ width: `${Math.min(100, Math.max(0, msg.toolData.capacity.headroomCpuPct))}%` }}
                                />
                              </div>
                              <div className="flex items-center justify-between text-[10px] text-slate-500">
                                <span>Used: {msg.toolData.capacity.usedCpu}</span>
                                <span>Allocatable: {msg.toolData.capacity.allocatableCpu}</span>
                              </div>
                            </div>

                            {/* Memory Card */}
                            <div className="bg-cyber-950/80 border border-cyber-800 p-3 rounded-xl">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-slate-400 text-[11px] uppercase tracking-wider">Memory Headroom</span>
                                <span className={`text-sm font-bold ${msg.toolData.capacity.headroomMemoryPct >= 40 ? 'text-emerald-400' : msg.toolData.capacity.headroomMemoryPct >= 20 ? 'text-amber-400' : 'text-rose-400'}`}>
                                  {msg.toolData.capacity.headroomMemoryPct}% Free
                                </span>
                              </div>
                              <div className="w-full bg-cyber-900 rounded-full h-2 my-2 overflow-hidden border border-cyber-800">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${msg.toolData.capacity.headroomMemoryPct >= 40 ? 'bg-gradient-to-r from-emerald-500 to-teal-400' : msg.toolData.capacity.headroomMemoryPct >= 20 ? 'bg-gradient-to-r from-amber-500 to-yellow-400' : 'bg-gradient-to-r from-rose-500 to-red-400'}`}
                                  style={{ width: `${Math.min(100, Math.max(0, msg.toolData.capacity.headroomMemoryPct))}%` }}
                                />
                              </div>
                              <div className="flex items-center justify-between text-[10px] text-slate-500">
                                <span>Used: {msg.toolData.capacity.usedMemory}</span>
                                <span>Allocatable: {msg.toolData.capacity.allocatableMemory}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Rich Pods & Workload Inventory Widget */}
                      {msg.toolData?.type === 'pods' && msg.toolData.pods && (
                        <div className="mt-3 pt-3 border-t border-cyber-800/80 space-y-2.5 font-mono">
                          <div className="flex items-center justify-between text-xs text-slate-400">
                            <span className="flex items-center gap-1.5 text-cyan-300 font-medium">
                              <Boxes className="w-3.5 h-3.5 text-cyan-400" />
                              Live Pod Telemetry {msg.toolData.pods.namespace ? `(${msg.toolData.pods.namespace})` : '(Cluster-Wide)'}
                            </span>
                            <span className="text-[10px] text-slate-500">{msg.toolData.pods.total} pod(s) registered</span>
                          </div>

                          {/* 4 Pod Status Metric Cards */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div className="bg-cyber-950/70 border border-cyber-800/80 p-2.5 rounded-xl flex flex-col justify-between">
                              <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider">Total Pods</span>
                              <div className="text-base font-bold text-white font-mono mt-1">{msg.toolData.pods.total}</div>
                              <span className="text-[10px] text-cyan-400 font-mono truncate mt-0.5">Live Kube-API</span>
                            </div>
                            <div className="bg-cyber-950/70 border border-cyber-800/80 p-2.5 rounded-xl flex flex-col justify-between">
                              <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider">Healthy Running</span>
                              <div className="text-base font-bold text-emerald-400 font-mono mt-1">{msg.toolData.pods.running}</div>
                              <span className="text-[10px] text-emerald-500/80 font-mono truncate mt-0.5">Phase: Running</span>
                            </div>
                            <div className="bg-cyber-950/70 border border-cyber-800/80 p-2.5 rounded-xl flex flex-col justify-between">
                              <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider">Pending</span>
                              <div className="text-base font-bold text-amber-400 font-mono mt-1">{msg.toolData.pods.pending}</div>
                              <span className="text-[10px] text-slate-500 font-mono truncate mt-0.5">Awaiting Nodes</span>
                            </div>
                            <div className="bg-cyber-950/70 border border-cyber-800/80 p-2.5 rounded-xl flex flex-col justify-between">
                              <span className="text-[10px] text-slate-400 uppercase font-mono tracking-wider">Completed / Jobs</span>
                              <div className="text-base font-bold text-blue-400 font-mono mt-1">{msg.toolData.pods.completed}</div>
                              <span className="text-[10px] text-slate-500 font-mono truncate mt-0.5">Phase: Succeeded</span>
                            </div>
                          </div>

                          {/* Namespace breakdown badges */}
                          {msg.toolData.pods.byNamespace && Object.keys(msg.toolData.pods.byNamespace).length > 0 && (
                            <div className="bg-cyber-950/60 border border-cyber-800/60 rounded-xl p-2.5">
                              <span className="text-[11px] font-semibold text-slate-300 block mb-1.5">
                                Namespace Breakdown:
                              </span>
                              <div className="flex flex-wrap gap-1.5">
                                {Object.entries(msg.toolData.pods.byNamespace).map(([ns, stats]: [string, any]) => (
                                  <span
                                    key={ns}
                                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-cyber-900 border border-cyber-800 text-[10px] font-mono text-slate-300"
                                  >
                                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                                    <span className="font-semibold text-slate-200">{ns}</span>
                                    <span className="text-cyan-400 font-bold">({stats.total})</span>
                                    {stats.failed > 0 && (
                                      <span className="text-rose-400 font-bold">[{stats.failed} err]</span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Active Pod Samples Table */}
                          {msg.toolData.pods.items && msg.toolData.pods.items.length > 0 && (
                            <div className="bg-cyber-950/60 border border-cyber-800/60 rounded-xl p-2.5 overflow-hidden">
                              <span className="text-[11px] font-semibold text-slate-300 block mb-1.5">
                                Active Pod Samples ({Math.min(msg.toolData.pods.items.length, 8)} of {msg.toolData.pods.total}):
                              </span>
                              <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs font-mono">
                                  <thead>
                                    <tr className="text-slate-500 border-b border-cyber-800 text-[10px]">
                                      <th className="pb-1">Pod</th>
                                      <th className="pb-1">Namespace</th>
                                      <th className="pb-1">Phase</th>
                                      <th className="pb-1">Ready</th>
                                      <th className="pb-1">Age</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-cyber-900/60">
                                    {msg.toolData.pods.items.slice(0, 8).map((pod: any, pIdx: number) => (
                                      <tr key={pIdx} className="hover:bg-cyber-900/30">
                                        <td className="py-1 text-slate-200 font-medium truncate max-w-[130px]" title={pod.name}>
                                          {pod.name}
                                        </td>
                                        <td className="py-1 text-cyan-400/90 truncate max-w-[85px]">{pod.namespace}</td>
                                        <td className="py-1">
                                          <span
                                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                                              pod.phase === 'Running'
                                                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/30'
                                                : pod.phase === 'Succeeded'
                                                ? 'bg-blue-950/80 text-blue-300 border border-blue-500/30'
                                                : 'bg-rose-950/80 text-rose-300 border border-rose-500/30'
                                            }`}
                                          >
                                            {pod.phase}
                                          </span>
                                        </td>
                                        <td className="py-1 text-slate-400">{pod.readyContainers}/{pod.totalContainers}</td>
                                        <td className="py-1 text-slate-500">{pod.age}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Rich Action Execution Widget */}
                      {msg.toolData?.type === 'action' && msg.toolData.action && (
                        <div className="mt-3 pt-3 border-t border-cyber-800/80 space-y-2.5 font-mono">
                          <div className="flex items-center justify-between text-xs text-slate-400">
                            <span className="flex items-center gap-1.5 text-cyan-300 font-medium">
                              <RotateCw className={`w-3.5 h-3.5 ${msg.toolData.action.status === 'success' ? 'text-emerald-400 animate-spin [animation-duration:3s]' : 'text-amber-400'}`} />
                              Cluster Operation: {msg.toolData.action.type === 'restart' ? 'Rollout Restart' : 'Scale Workload'}
                            </span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                              msg.toolData.action.status === 'success'
                                ? 'bg-emerald-950/80 border border-emerald-500/40 text-emerald-300'
                                : 'bg-rose-950/80 border border-rose-500/40 text-rose-300'
                            }`}>
                              {msg.toolData.action.status === 'success' ? 'Executed ⚡' : 'Failed ⚠️'}
                            </span>
                          </div>

                          {/* Action Details Card */}
                          <div className="bg-cyber-950/80 border border-cyber-800 p-3 rounded-xl space-y-2">
                            <div className="flex items-center justify-between text-xs border-b border-cyber-800/70 pb-2">
                              <div>
                                <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Target Workload</span>
                                <span className="text-sm font-bold text-white flex items-center gap-1.5 mt-0.5">
                                  <Layers className="w-3.5 h-3.5 text-cyan-400" />
                                  {msg.toolData.action.kind}/{msg.toolData.action.name}
                                </span>
                              </div>
                              <div className="text-right">
                                <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Namespace</span>
                                <span className="text-xs font-semibold text-cyan-300 px-2 py-0.5 bg-cyan-950/60 border border-cyan-500/30 rounded-lg inline-block mt-0.5">
                                  {msg.toolData.action.namespace}
                                </span>
                              </div>
                            </div>

                            {/* Replicas & Timestamp status */}
                            <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                              {msg.toolData.action.replicas && (
                                <div className="bg-cyber-900/60 p-2 rounded-lg border border-cyber-800/60">
                                  <span className="text-[10px] text-slate-500 block">Replicas State</span>
                                  {msg.toolData.action.replicas.desired !== undefined ? (
                                    <span className="text-slate-200 font-bold">
                                      {msg.toolData.action.replicas.ready ?? 0} / {msg.toolData.action.replicas.desired} Ready
                                    </span>
                                  ) : (
                                    <span className="text-slate-200 font-bold">
                                      {msg.toolData.action.replicas.previous} → {msg.toolData.action.replicas.new} Replicas
                                    </span>
                                  )}
                                </div>
                              )}

                              <div className="bg-cyber-900/60 p-2 rounded-lg border border-cyber-800/60">
                                <span className="text-[10px] text-slate-500 block">Operation Timestamp</span>
                                <span className="text-slate-300 font-mono text-[10px] truncate block" title={msg.toolData.action.restartedAt}>
                                  {msg.toolData.action.restartedAt ? new Date(msg.toolData.action.restartedAt).toLocaleTimeString() : 'Just now'}
                                </span>
                              </div>
                            </div>

                            {/* Interactive Quick Actions on the Card */}
                            <div className="pt-2 border-t border-cyber-800/60 flex flex-wrap items-center gap-1.5">
                              {msg.toolData.action.rolloutCommand && (
                                <button
                                  onClick={() => handleSendMessage(`How many pods are in namespace ${msg.toolData.action.namespace}?`)}
                                  className="px-2.5 py-1 bg-cyber-900 hover:bg-cyan-950/60 border border-cyber-700 hover:border-cyan-500/50 rounded-lg text-[10px] text-slate-300 hover:text-cyan-300 transition-all flex items-center gap-1"
                                >
                                  <Boxes className="w-3 h-3 text-cyan-400" />
                                  Check Pods ({msg.toolData.action.namespace})
                                </button>
                              )}
                              <button
                                onClick={() => handleSendMessage(`Can you restart the ${msg.toolData.action.name} deployment for me?`)}
                                className="px-2.5 py-1 bg-cyber-900 hover:bg-cyber-800 border border-cyber-700 hover:border-slate-500 rounded-lg text-[10px] text-slate-300 hover:text-white transition-all flex items-center gap-1"
                              >
                                <RotateCw className="w-3 h-3 text-slate-400" />
                                Re-trigger Restart
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Footer Info & Copy Button */}
                      <div className="flex items-center justify-between pt-2.5 text-[10px] text-slate-500 font-mono border-t border-cyber-800/50 mt-3">
                        <div className="flex items-center gap-2">
                          <span className="text-cyan-400/90 flex items-center gap-1">
                            <Zap className="w-3 h-3" />
                            {msg.model || status.model}
                          </span>
                          <span>•</span>
                          <span className="text-slate-400">{msg.hardware || status.hardware}</span>
                        </div>
                        <button
                          onClick={() => copyToClipboard(msg.id, msg.content)}
                          className="hover:text-white px-2 py-1 bg-cyber-950 hover:bg-cyber-800 border border-cyber-800 rounded-md transition-colors flex items-center gap-1.5"
                          title="Copy response markdown"
                        >
                          {copiedId === msg.id ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-400 font-semibold">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Contextual Follow-up Chips */}
                      <div className="mt-2 pt-2 border-t border-cyber-800/30 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider mr-1">Suggested:</span>
                        {msg.toolData?.type === 'action' ? (
                          <>
                            <button
                              onClick={() => handleSendMessage(`How many pods are in namespace ${msg.toolData.action.namespace}?`)}
                              className="px-2 py-0.5 bg-cyber-950 hover:bg-cyber-800 border border-cyber-800 hover:border-cyan-500/40 rounded-lg text-[10px] text-slate-300 hover:text-cyan-300 transition-colors"
                            >
                              Pods in {msg.toolData.action.namespace}
                            </button>
                            <button
                              onClick={() => handleSendMessage('Scan for warning events or crashloops')}
                              className="px-2 py-0.5 bg-cyber-950 hover:bg-cyber-800 border border-cyber-800 hover:border-cyan-500/40 rounded-lg text-[10px] text-slate-300 hover:text-cyan-300 transition-colors"
                            >
                              Warning Events
                            </button>
                            <button
                              onClick={() => handleSendMessage('Show host cluster capacity and headroom')}
                              className="px-2 py-0.5 bg-cyber-950 hover:bg-cyber-800 border border-cyber-800 hover:border-cyan-500/40 rounded-lg text-[10px] text-slate-300 hover:text-cyan-300 transition-colors"
                            >
                              Cluster Capacity
                            </button>
                          </>
                        ) : msg.toolData?.type === 'pods' ? (
                          <>
                            <button
                              onClick={() => handleSendMessage('Show host cluster capacity and headroom')}
                              className="px-2 py-0.5 bg-cyber-950 hover:bg-cyber-800 border border-cyber-800 hover:border-cyan-500/40 rounded-lg text-[10px] text-slate-300 hover:text-cyan-300 transition-colors"
                            >
                              Cluster Capacity
                            </button>
                            <button
                              onClick={() => handleSendMessage('Scan for warning events or crashloops')}
                              className="px-2 py-0.5 bg-cyber-950 hover:bg-cyber-800 border border-cyber-800 hover:border-cyan-500/40 rounded-lg text-[10px] text-slate-300 hover:text-cyan-300 transition-colors"
                            >
                              Warning Events
                            </button>
                            <button
                              onClick={() => handleSendMessage('What is the average CPU usage of namespace vcop-system for the past 10 hours?')}
                              className="px-2 py-0.5 bg-cyber-950 hover:bg-cyber-800 border border-cyber-800 hover:border-cyan-500/40 rounded-lg text-[10px] text-slate-300 hover:text-cyan-300 transition-colors"
                            >
                              vcop-system CPU
                            </button>
                          </>
                        ) : msg.toolData?.type === 'metrics' ? (
                          <>
                            <button
                              onClick={() => handleSendMessage('Show host cluster capacity and headroom')}
                              className="px-2 py-0.5 bg-cyber-950 hover:bg-cyber-800 border border-cyber-800 hover:border-cyan-500/40 rounded-lg text-[10px] text-slate-300 hover:text-cyan-300 transition-colors"
                            >
                              Host Capacity
                            </button>
                            <button
                              onClick={() => handleSendMessage('Scan for warning events or crashloops')}
                              className="px-2 py-0.5 bg-cyber-950 hover:bg-cyber-800 border border-cyber-800 hover:border-cyan-500/40 rounded-lg text-[10px] text-slate-300 hover:text-cyan-300 transition-colors"
                            >
                              Warning Events
                            </button>
                          </>
                        ) : msg.toolData?.type === 'capacity' ? (
                          <>
                            <button
                              onClick={() => handleSendMessage('What is the average CPU usage of namespace istio-system for the past 10 hours?')}
                              className="px-2 py-0.5 bg-cyber-950 hover:bg-cyber-800 border border-cyber-800 hover:border-cyan-500/40 rounded-lg text-[10px] text-slate-300 hover:text-cyan-300 transition-colors"
                            >
                              istio-system 10h CPU
                            </button>
                            <button
                              onClick={() => handleSendMessage('List all virtual clusters and their Istio status')}
                              className="px-2 py-0.5 bg-cyber-950 hover:bg-cyber-800 border border-cyber-800 hover:border-cyan-500/40 rounded-lg text-[10px] text-slate-300 hover:text-cyan-300 transition-colors"
                            >
                              Virtual Clusters
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleSendMessage('Show cluster capacity and resource headroom')}
                              className="px-2 py-0.5 bg-cyber-950 hover:bg-cyber-800 border border-cyber-800 hover:border-cyan-500/40 rounded-lg text-[10px] text-slate-300 hover:text-cyan-300 transition-colors"
                            >
                              Cluster Capacity
                            </button>
                            <button
                              onClick={() => handleSendMessage('What is the average CPU usage of namespace istio-system for the past 10 hours?')}
                              className="px-2 py-0.5 bg-cyber-950 hover:bg-cyber-800 border border-cyber-800 hover:border-cyan-500/40 rounded-lg text-[10px] text-slate-300 hover:text-cyan-300 transition-colors"
                            >
                              Namespace Telemetry
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex flex-col items-start space-y-1">
                <div className="bg-cyber-900/90 border border-cyber-800 rounded-2xl rounded-bl-none p-3.5 flex items-center gap-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                    <span className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                    <span className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce"></span>
                  </div>
                  <span className="text-xs text-slate-400 font-mono">
                    Querying cluster telemetry & synthesizing with Gemma 3...
                  </span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-3 bg-cyber-900/90 border-t border-cyber-800">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-end gap-2"
            >
              <div className="flex-1 bg-cyber-950 border border-cyber-700/80 focus-within:border-cyan-500/80 rounded-xl p-2 transition-all">
                <textarea
                  ref={textareaRef}
                  value={inputPrompt}
                  onChange={(e) => {
                    setInputPrompt(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  rows={1}
                  placeholder="Ask about CPU, memory, headroom, namespaces, virtual clusters..."
                  className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-500 resize-none focus:outline-none max-h-[120px]"
                />
              </div>

              <button
                type="submit"
                disabled={!inputPrompt.trim() || loading}
                className="p-2.5 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-cyan-500/25 transition-all shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
            <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono mt-1.5 px-1">
              <span>Press Enter to send, Shift+Enter for new line</span>
              <span>Gemma 3 • Offline Self-Contained</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
