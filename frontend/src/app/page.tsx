"use client";

import { useState, useCallback, useEffect } from "react";
import { Upload, MessageSquare, BarChart2 } from "lucide-react";
import ChatWindow from "@/components/ChatWindow";
import SourcePanel from "@/components/SourcePanel";
import UploadZone from "@/components/UploadZone";
import Sidebar from "@/components/Sidebar";
import ThemeToggle from "@/components/ThemeToggle";
import { listConversations } from "@/lib/api";
import type { Citation, ConversationSummary } from "@/lib/types";

type Tab = "chat" | "upload";

export default function HomePage() {
  const [activeTab, setActiveTab]             = useState<Tab>("chat");
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [activeCitations, setActiveCitations] = useState<Citation[]>([]);

  // Conversation / sidebar state
  const [sidebarOpen, setSidebarOpen]               = useState(true);
  const [conversations, setConversations]           = useState<ConversationSummary[]>([]);
  const [loadingConvs, setLoadingConvs]             = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  // Bumping this remounts ChatWindow (fresh state) when switching chats.
  const [chatKey, setChatKey] = useState("new-0");

  const refreshConversations = useCallback(async () => {
    setLoadingConvs(true);
    try {
      setConversations(await listConversations());
    } finally {
      setLoadingConvs(false);
    }
  }, []);

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  const handleCitationClick = (citations: Citation[]) => {
    setActiveCitations(citations);
    setSourcePanelOpen(true);
  };

  // Sidebar selected an existing conversation → load it.
  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
    setChatKey(`load-${id}`);
    setActiveTab("chat");
    setSourcePanelOpen(false);
  }, []);

  // New chat → reset ChatWindow.
  const handleNewChat = useCallback(() => {
    setActiveConversationId(null);
    setChatKey(`new-${Date.now()}`);
    setActiveTab("chat");
    setSourcePanelOpen(false);
  }, []);

  // ChatWindow created a brand-new conversation → track it + refresh list.
  const handleConversationId = useCallback(
    (id: string) => {
      setActiveConversationId(id);
      refreshConversations();
    },
    [refreshConversations]
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-edge bg-app shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center text-sm font-bold text-white">
            R
          </div>
          <span className="font-semibold text-content tracking-tight">RAGStack</span>
          <span className="text-xs text-faint hidden sm:inline">
            Agentic RAG · Hybrid Search · Guardrails
          </span>
        </div>

        {/* Tab switcher */}
        <nav className="flex gap-1 bg-surface border border-edge rounded-lg p-1">
          {(["chat", "upload"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "bg-accent text-white"
                  : "text-muted hover:text-content"
              }`}
            >
              {tab === "chat"   && <MessageSquare size={14} />}
              {tab === "upload" && <Upload size={14} />}
              {tab === "chat"   ? "Chat" : "Upload"}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <a
            href="https://smith.langchain.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-muted hover:text-content transition-colors"
          >
            <BarChart2 size={13} />
            LangSmith
          </a>
          <ThemeToggle />
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar (chat history) */}
        <Sidebar
          open={sidebarOpen}
          onToggle={() => setSidebarOpen((v) => !v)}
          conversations={conversations}
          loading={loadingConvs}
          activeConversationId={activeConversationId}
          onSelect={handleSelectConversation}
          onNewChat={handleNewChat}
          onRefresh={refreshConversations}
        />

        {/* Main area */}
        <main className="flex flex-1 overflow-hidden">
          {activeTab === "chat" && (
            <>
              <div className="flex-1 min-w-0">
                <ChatWindow
                  key={chatKey}
                  initialConversationId={activeConversationId}
                  onCitationClick={handleCitationClick}
                  onConversationId={handleConversationId}
                  onAfterResponse={refreshConversations}
                />
              </div>
              {sourcePanelOpen && (
                <SourcePanel
                  citations={activeCitations}
                  onClose={() => setSourcePanelOpen(false)}
                />
              )}
            </>
          )}

          {activeTab === "upload" && (
            <div className="flex-1 flex items-start justify-center p-8 overflow-y-auto">
              <div className="w-full max-w-2xl">
                <h2 className="text-xl font-semibold mb-1 text-content">Upload Documents</h2>
                <p className="text-muted text-sm mb-6">
                  PDF, DOCX, CSV, TXT — up to 50 MB. Documents are parsed, chunked,
                  embedded, and indexed for hybrid search.
                </p>
                <UploadZone />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
