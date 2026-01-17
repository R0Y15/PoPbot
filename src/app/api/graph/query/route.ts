import { NextRequest, NextResponse } from "next/server";
import { queryGraph, generateAnswer } from "@/lib/graph-rag";

export async function POST(req: NextRequest) {
  try {
    const { query, documentName, history } = await req.json();

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'query' field" },
        { status: 400 }
      );
    }

    console.log("[GraphQuery] query:", query, "document:", documentName, "history:", (history || []).length, "msgs");
    const graphContext = await queryGraph(query, documentName);
    console.log("[GraphQuery] context — facts:", graphContext.facts.length, "chunks:", graphContext.chunks.length);
    const answer = await generateAnswer(query, graphContext, history);

    return NextResponse.json({
      text: answer,
      graphContext: {
        factsUsed: graphContext.facts.length,
        chunksUsed: graphContext.chunks.length,
        entities: graphContext.entityCount,
        relationships: graphContext.relationshipCount,
      },
    });
  } catch (err) {
    console.error("Graph query error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
