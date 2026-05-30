"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Upload, CheckCircle2, XCircle, Loader2, FileText, Trash2, Database } from "lucide-react";
import { uploadDocument, listDocuments, deleteDocument } from "@/lib/api";
import type { IngestionResult, DocumentInfo } from "@/lib/types";

type Status = "idle" | "uploading" | "success" | "error";

interface UploadRecord {
  file: File;
  status: Status;
  result?: IngestionResult;
  error?: string;
}

const ACCEPTED = ".pdf,.docx,.csv,.txt,.xlsx";

export default function UploadZone() {
  const [records,   setRecords]   = useState<UploadRecord[]>([]);
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [dragOver,  setDragOver]  = useState(false);
  const [strategy,  setStrategy]  = useState<"recursive" | "semantic">("recursive");
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch the persisted document list from the backend on mount.
  const refreshDocuments = useCallback(async () => {
    setLoadingDocs(true);
    try {
      setDocuments(await listDocuments());
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    refreshDocuments();
  }, [refreshDocuments]);

  const processFiles = useCallback(
    async (files: File[]) => {
      const newRecords: UploadRecord[] = files.map((f) => ({
        file: f,
        status: "uploading",
      }));
      setRecords((prev) => [...prev, ...newRecords]);

      await Promise.all(
        files.map(async (file) => {
          try {
            const result = await uploadDocument(file, strategy);
            setRecords((prev) =>
              prev.map((r) =>
                r.file === file ? { ...r, status: "success", result } : r
              )
            );
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setRecords((prev) =>
              prev.map((r) =>
                r.file === file ? { ...r, status: "error", error: msg } : r
              )
            );
          }
        })
      );

      // Refresh the persisted list once uploads settle.
      refreshDocuments();
    },
    [strategy, refreshDocuments]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length) processFiles(files);
    },
    [processFiles]
  );

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length) processFiles(files);
      e.target.value = "";
    },
    [processFiles]
  );

  const handleDelete = useCallback(
    async (sourceFile: string) => {
      setDocuments((prev) => prev.filter((d) => d.source_file !== sourceFile));
      await deleteDocument(sourceFile);
      refreshDocuments();
    },
    [refreshDocuments]
  );

  // Only show in-progress / failed uploads here; successful ones appear in the
  // persisted "Knowledge base" list below.
  const activeRecords = records.filter((r) => r.status !== "success");

  return (
    <div className="space-y-6">
      {/* Strategy selector */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-400">Chunking strategy:</span>
        {(["recursive", "semantic"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStrategy(s)}
            className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
              strategy === s
                ? "bg-blue-600 text-white"
                : "bg-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Drop zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-12 cursor-pointer transition-colors ${
          dragOver
            ? "border-blue-500 bg-blue-950/30"
            : "border-slate-600 bg-slate-800/50 hover:border-slate-500 hover:bg-slate-800"
        }`}
      >
        <Upload
          size={32}
          className={`transition-colors ${dragOver ? "text-blue-400" : "text-slate-500"}`}
        />
        <div className="text-center">
          <p className="text-sm font-medium text-slate-200">
            Drop files here or <span className="text-blue-400">browse</span>
          </p>
          <p className="text-xs text-slate-500 mt-1">PDF, DOCX, CSV, XLSX, TXT · max 50 MB</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED}
          onChange={onInputChange}
          className="hidden"
        />
      </div>

      {/* In-progress / failed uploads */}
      {activeRecords.length > 0 && (
        <ul className="space-y-2">
          {activeRecords.map((rec, i) => (
            <UploadRow key={i} record={rec} />
          ))}
        </ul>
      )}

      {/* Persisted knowledge-base documents */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Database size={15} className="text-slate-400" />
          <h3 className="text-sm font-medium text-slate-200">
            Knowledge Base
            {!loadingDocs && (
              <span className="text-slate-500 font-normal"> · {documents.length} document
                {documents.length === 1 ? "" : "s"}</span>
            )}
          </h3>
        </div>

        {loadingDocs ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
            <Loader2 size={14} className="animate-spin" /> Loading documents…
          </div>
        ) : documents.length === 0 ? (
          <p className="text-sm text-slate-500 py-4 text-center border border-dashed border-slate-700 rounded-xl">
            No documents yet. Upload a file to build your knowledge base.
          </p>
        ) : (
          <ul className="space-y-2">
            {documents.map((doc) => (
              <DocumentRow key={doc.source_file} doc={doc} onDelete={handleDelete} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DocumentRow({
  doc,
  onDelete,
}: {
  doc: DocumentInfo;
  onDelete: (sourceFile: string) => void;
}) {
  return (
    <li className="group flex items-center gap-3 rounded-xl bg-slate-800 border border-slate-700 px-4 py-3">
      <FileText size={16} className="shrink-0 text-blue-400" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-200 truncate">{doc.source_file}</p>
        <div className="flex flex-wrap gap-x-4 mt-0.5 text-xs text-slate-500">
          <span>{doc.chunk_count} chunks</span>
          {doc.file_type && <span>{doc.file_type.toUpperCase()}</span>}
          {doc.chunking_strategy && <span>{doc.chunking_strategy}</span>}
        </div>
      </div>
      <button
        onClick={() => onDelete(doc.source_file)}
        className="shrink-0 text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
        title="Remove from knowledge base"
      >
        <Trash2 size={15} />
      </button>
    </li>
  );
}

function UploadRow({ record }: { record: UploadRecord }) {
  const { file, status, error } = record;
  return (
    <li className="flex items-start gap-3 rounded-xl bg-slate-800 border border-slate-700 px-4 py-3">
      <div className="shrink-0 mt-0.5">
        {status === "uploading" && <Loader2 size={16} className="animate-spin text-blue-400" />}
        {status === "success"   && <CheckCircle2 size={16} className="text-emerald-400" />}
        {status === "error"     && <XCircle size={16} className="text-red-400" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-200 truncate">{file.name}</p>
        {status === "uploading" && (
          <p className="text-xs text-slate-500 mt-0.5">Parsing, chunking, embedding…</p>
        )}
        {status === "error" && (
          <p className="text-xs text-red-400 mt-0.5">{error}</p>
        )}
      </div>
    </li>
  );
}
