import { NextRequest, NextResponse } from "next/server";
import { buildGraphFromDocument } from "@/lib/graph-rag";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { text, documentName } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'text' field" },
        { status: 400 }
      );
    }

    const name = documentName || `document-${Date.now()}`;

    const stats = await buildGraphFromDocument(text, name);

    return NextResponse.json({
      success: true,
      documentName: name,
      stats,
    });
  } catch (err) {
    console.error("Graph build error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
