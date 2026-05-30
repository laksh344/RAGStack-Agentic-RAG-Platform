"use client";

import { useEffect, useCallback } from "react";
import { PanelLeftClose, PanelLeft, Plus, MessageSquare, Loader2 } from "lucide-react";
import type { ConversationSummary } from "@/lib/types";

interface Props {
  open: boolean;
  onToggle: () => void;
  conversations: ConversationSummary[];
  loading: boolean;
  activeConversationId: string | null;
  onSelect: (conversationId: string) => void;
  onNewChat: () => void;
  onRefresh: () => void;
}

export default function Sidebar({
  open,
  onToggle,
  conversations,
  loading,
  activeConversationId,
  onSelect,
  onNewChat,
  onRefresh,
}: Props) {
  // Refresh the conversation list whenever the sidebar opens.
  useEffect(() => {
    if (open) onRefresh();
  }, [open, onRefresh]);

  const handleNewChat = useCallback(() => {
    onNewChat();
  }, [onNewChat]);

  // Collapsed: a thin rail with just the hamburger.
  if (!open) {
    return (
      <div className="shrink-0 w-12 border-r border-slate-700 bg-slate-900 flex flex-col items-center py-3 gap-3">
        <button
          onClick={onToggle}
          className="text-slate-400 hover:text-slate-100 transition-colors"
          title="Open sidebar"
        >
          <PanelLeft size={18} />
        </button>
        <button
          onClick={handleNewChat}
          className="text-slate-400 hover:text-slate-100 transition-colors"
          title="New chat"
        >
          <Plus size={18} />
        </button>
      </div>
    );
  }

  return (
    <aside className="shrink-0 w-64 border-r border-slate-700 bg-slate-900 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-slate-800">
        <span className="text-sm font-medium text-slate-300">Chats</span>
        <button
          onClick={onToggle}
          className="text-slate-400 hover:text-slate-100 transition-colors"
          title="Collapse sidebar"
        >
          <PanelLeftClose size={18} />
        </button>
      </div>

      {/* New chat */}
      <div className="p-3">
        <button
          onClick={handleNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
        >
          <Plus size={15} />
          New chat
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 px-2 py-3">
            <Loader2 size={13} className="animate-spin" /> Loading…
          </div>
        ) : conversations.length === 0 ? (
          <p className="text-xs text-slate-600 px-2 py-3 text-center">
            No conversations yet.
          </p>
        ) : (
          conversations.map((c) => (
            <button
              key={c.conversation_id}
              onClick={() => onSelect(c.conversation_id)}
              className={`w-full flex items-start gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                c.conversation_id === activeConversationId
                  ? "bg-slate-800 text-slate-100"
                  : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
              }`}
            >
              <MessageSquare size={14} className="shrink-0 mt-0.5 text-slate-500" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm truncate">{c.preview || "Untitled chat"}</span>
                <span className="block text-[11px] text-slate-600">
                  {c.message_count} message{c.message_count === 1 ? "" : "s"}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
