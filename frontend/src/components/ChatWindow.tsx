"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, ThumbsUp, ThumbsDown, AlertTriangle, Loader2 } from "lucide-react";
import { streamChat, submitFeedback, getConversation } from "@/lib/api";
import type { Message, Citation } from "@/lib/types";

interface Props {
  // The conversation to resume, or null for a fresh chat. The parent forces a
  // remount (via key) when this changes, so it is only read on mount.
  initialConversationId: string | null;
  onCitationClick: (citations: Citation[]) => void;
  onConversationId: (id: string) => void;
  onAfterResponse?: () => void;
}

const WELCOME = `Hi! I'm RAGStack — an agentic RAG assistant.

Upload documents using the **Upload** tab, then ask me anything about them. I'll search your knowledge base with hybrid vector + keyword search, rerank with Cohere, and generate a cited, grounded answer.

Try asking: *"What are the main topics in the uploaded documents?"*`;

export default function ChatWindow({
  initialConversationId,
  onCitationClick,
  onConversationId,
  onAfterResponse,
}: Props) {
  const [messages,   setMessages]   = useState<Message[]>([]);
  const [input,      setInput]      = useState("");
  const [streaming,  setStreaming]  = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const convIdRef  = useRef<string | null>(initialConversationId);

  // Load prior messages when resuming an existing conversation (on mount).
  useEffect(() => {
    let cancelled = false;
    if (initialConversationId) {
      setLoadingHistory(true);
      getConversation(initialConversationId)
        .then((msgs) => {
          if (!cancelled) setMessages(msgs);
        })
        .finally(() => {
          if (!cancelled) setLoadingHistory(false);
        });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = useCallback(async () => {
    const query = input.trim();
    if (!query || streaming) return;

    setInput("");
    setStreaming(true);

    // Add user message
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: query,
      citations: [],
      guardrail_flags: [],
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    // Placeholder assistant message (streams in)
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      citations: [],
      guardrail_flags: [],
      timestamp: new Date().toISOString(),
      streaming: true,
    };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      await streamChat(query, convIdRef.current, {
        onToken: (token) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + token } : m
            )
          );
        },
        onCitations: (citations) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, citations } : m))
          );
        },
        onFlags: (flags) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, guardrail_flags: flags } : m
            )
          );
        },
        onDone: (_, newConvId) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, streaming: false } : m
            )
          );
          const wasNew = !convIdRef.current;
          if (wasNew) onConversationId(newConvId);
          convIdRef.current = newConvId;
          setStreaming(false);
          onAfterResponse?.();   // refresh sidebar history
        },
        onError: (detail) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: `Error: ${detail}`, streaming: false }
                : m
            )
          );
          setStreaming(false);
        },
      });
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: "Connection error — is the backend running?", streaming: false }
            : m
        )
      );
      setStreaming(false);
    }
  }, [input, streaming, onConversationId, onAfterResponse]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Message list ─────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {loadingHistory && (
          <div className="flex items-center justify-center gap-2 text-sm text-faint py-8">
            <Loader2 size={15} className="animate-spin" /> Loading conversation…
          </div>
        )}
        {!loadingHistory && messages.length === 0 && (
          <WelcomeCard message={WELCOME} />
        )}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onCitationClick={onCitationClick}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ── Input bar ─────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-edge bg-app px-4 py-3">
        <div className="flex items-end gap-3 max-w-4xl mx-auto">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about your documents…"
            rows={1}
            disabled={streaming}
            className="flex-1 resize-none rounded-xl bg-surface border border-edge px-4 py-3 text-sm text-content placeholder-faint focus:outline-none focus:border-accent disabled:opacity-50 max-h-36 overflow-y-auto"
            style={{ lineHeight: "1.5" }}
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || streaming}
            className="shrink-0 w-10 h-10 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
            aria-label="Send"
          >
            {streaming
              ? <Loader2 size={16} className="animate-spin text-white" />
              : <Send size={16} className="text-white" />
            }
          </button>
        </div>
        <p className="text-xs text-faint text-center mt-2">
          Hybrid search → Cohere rerank → LLM · LangSmith traced
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Strip inline "[Source: file, page N]" markers from the answer prose — the
// same references are shown as clickable badges below the bubble, so keeping
// them inline just clutters the text.
function cleanAnswer(text: string): string {
  return text
    .replace(/\s*\[Source:[^\]]*\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

// Collapse duplicate citations (same file + page) so we don't render three
// identical badges.
function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of citations) {
    const key = `${c.source_file}|${c.page_number}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function WelcomeCard({ message }: { message: string }) {
  return (
    <div className="max-w-2xl mx-auto text-center py-12 px-6">
      <div className="w-12 h-12 rounded-2xl bg-accent flex items-center justify-center text-xl font-bold mx-auto mb-4 text-white">
        R
      </div>
      <h1 className="text-xl font-semibold mb-2 text-content">RAGStack Assistant</h1>
      <p className="text-muted text-sm leading-relaxed whitespace-pre-line">
        {message.replace(/\*\*/g, "").replace(/\*/g, "")}
      </p>
    </div>
  );
}

function MessageBubble({
  message,
  onCitationClick,
}: {
  message: Message;
  onCitationClick: (c: Citation[]) => void;
}) {
  const isUser = message.role === "user";
  const hasFlags = message.guardrail_flags.length > 0;

  // Clean the displayed prose for assistant messages; users see their own text.
  const displayText = isUser ? message.content : cleanAnswer(message.content);
  const citations = dedupeCitations(message.citations);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} max-w-4xl mx-auto w-full`}>
      <div className={`max-w-[80%] ${isUser ? "order-2" : ""}`}>
        {/* Bubble */}
        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? "bg-accent text-white rounded-br-sm"
              : "bg-surface text-content rounded-bl-sm border border-edge"
          }`}
        >
          <span className={message.streaming ? "streaming-cursor" : ""}>
            {displayText || (message.streaming ? "" : "…")}
          </span>
        </div>

        {/* References (deduped, shown at the end) */}
        {citations.length > 0 && (
          <div className="mt-2">
            <div className="text-[11px] uppercase tracking-wide text-faint mb-1">
              References
            </div>
            <div className="flex flex-wrap gap-1.5">
              {citations.map((cit, i) => (
                <button
                  key={i}
                  onClick={() => onCitationClick(citations)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-elevated hover:bg-accent hover:text-white text-xs text-muted transition-colors"
                >
                  <span className="text-accent">↗</span>
                  {cit.source_file} · p.{cit.page_number}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Guardrail flags */}
        {hasFlags && (
          <div className="flex items-center gap-1.5 mt-1.5 text-xs text-amber-500">
            <AlertTriangle size={11} />
            {message.guardrail_flags.join(", ")}
          </div>
        )}

        {/* Feedback (assistant messages only, after streaming) */}
        {!isUser && !message.streaming && (
          <div className="flex gap-2 mt-1.5">
            <button
              onClick={() => submitFeedback(message.id, 1)}
              className="text-faint hover:text-emerald-500 transition-colors"
              title="Good response"
            >
              <ThumbsUp size={13} />
            </button>
            <button
              onClick={() => submitFeedback(message.id, -1)}
              className="text-faint hover:text-red-500 transition-colors"
              title="Bad response"
            >
              <ThumbsDown size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
