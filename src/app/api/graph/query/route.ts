import { NextRequest, NextResponse } from "next/server";
import { queryGraph, generateAnswer } from "@/lib/graph-rag";

export async function POST(req: NextRequest) {
  try {
    const { query, documentName } = await req.json();

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'query' field" },
        { status: 400 }
      );
    }

    const graphContext = await queryGraph(query, documentName);
    const answer = await generateAnswer(query, graphContext);

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
