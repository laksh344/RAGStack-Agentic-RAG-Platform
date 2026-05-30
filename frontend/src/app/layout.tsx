import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RAGStack — Agentic RAG Platform",
  description:
    "Production RAG platform with hybrid search, LangGraph agent, guardrails, and LangSmith observability.",
};

// Applied before paint so the saved theme is in place with no flash.
const themeScript = `
(function () {
  try {
    var t = localStorage.getItem("ragstack-theme");
    if (t === "light") document.documentElement.classList.add("light");
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-app text-content antialiased">
        {children}
      </body>
    </html>
  );
}
