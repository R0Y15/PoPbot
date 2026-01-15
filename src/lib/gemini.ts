import { api } from "../../convex/_generated/api";

/**
 * Graph-based RAG chat — queries the Neo4j knowledge graph via the server-side
 * API route. Used when a document has been successfully indexed into the graph.
 */
export async function graphChat(
  message: string,
  documentName: string
): Promise<{ text: string }> {
  const res = await fetch("/api/graph/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: message, documentName }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || "Graph query failed");
  }

  const data = await res.json();
  if (!data.text) throw new Error("Empty response from graph query");

  return { text: data.text };
}

/**
 * Legacy chat — forwards the full document text as context to Gemini via
 * a Convex action. Used as fallback when the knowledge graph is unavailable.
 */
export async function chat(
  message: string,
  convex: any,
  documentContext: string | null = null
) {
  try {
    const geminiApiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    const pineconeApiKey = process.env.NEXT_PUBLIC_PINECONE_API_KEY;

    if (!geminiApiKey) {
      throw new Error("Missing GEMINI_API_KEY environment variable");
    }

    const response = await convex.action(api.documents.queryDocuments, {
      query: message,
      context: documentContext || undefined,
      geminiApiKey,
      pineconeApiKey: pineconeApiKey || "unused",
    });

    if (!response || !response.text) {
      throw new Error("Invalid response from AI");
    }

    return response;
  } catch (error: any) {
    console.error("Error in chat:", error);
    throw new Error(
      error.message ? `AI Error: ${error.message}` : "Failed to get response from AI, please try again"
    );
  }
} 