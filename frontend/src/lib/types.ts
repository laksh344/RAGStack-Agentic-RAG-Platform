// Mirrors backend/agent/state.py Citation TypedDict
export interface Citation {
  source_file: string;
  page_number: number;
  excerpt: string;
}

// Mirrors backend/models/conversation.py Message
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  guardrail_flags: string[];
  timestamp: string;
  streaming?: boolean;   // true while tokens are arriving
}

// SSE event payloads from POST /api/v1/chat
export type SSEEvent =
  | { type: "token";          content: string }
  | { type: "citations";      data: Citation[] }
  | { type: "guardrail_flags"; data: string[] }
  | { type: "done";           message_id: string; conversation_id: string }
  | { type: "error";          detail: string };

// Mirrors backend/models/document.py IngestionResult
export interface IngestionResult {
  document_id: string;
  source_file: string;
  file_type: string;
  total_pages: number;
  total_chunks: number;
  chunking_strategy: string;
  avg_chunk_size: number;
  total_characters: number;
  estimated_tokens: number;
  processing_time_seconds: number;
  errors: string[];
}

// Chunk from retrieval (used in SourcePanel)
export interface RetrievedChunk {
  chunk_id: string;
  content: string;
  source_file: string;
  page_number: number;
  score: number;
  title: string;
}

// A document currently in the knowledge base (GET /ingest/documents)
export interface DocumentInfo {
  source_file: string;
  chunk_count: number;
  file_type: string;
  chunking_strategy: string;
}

// A conversation summary for the sidebar (GET /chat/conversations)
export interface ConversationSummary {
  conversation_id: string;
  preview: string;
  message_count: number;
  updated_at: string;
}
