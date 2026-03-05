import { NextRequest, NextResponse } from "next/server";
import { runCypher } from "@/lib/neo4j";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await runCypher("MATCH (n) DETACH DELETE n");

    return NextResponse.json({
      success: true,
      message: "Neo4j database cleared successfully",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to clear Neo4j database:", error);
    return NextResponse.json(
      { error: "Failed to clear database" },
      { status: 500 }
    );
  }
}
