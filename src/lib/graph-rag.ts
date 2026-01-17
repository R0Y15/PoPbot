import { ChatGoogleGenerativeAI, GoogleGenerativeAIChatInput } from "@langchain/google-genai";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { runCypher } from "./neo4j";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ExtractedEntity {
  name: string;
  type: string;
  description: string;
}

export interface ExtractedRelationship {
  source: string;
  relation: string;
  target: string;
  description: string;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

export interface GraphContext {
  facts: string[];
  chunks: string[];
  entityCount: number;
  relationshipCount: number;
}

// ── LLM setup ───────────────────────────────────────────────────────────────

function getModel() {
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing NEXT_PUBLIC_GEMINI_API_KEY in environment");

  return new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash-lite",
    apiKey: apiKey,
    temperature: 0.1,
    maxOutputTokens: 4096,
  } as GoogleGenerativeAIChatInput);
}

// ── Text chunking ───────────────────────────────────────────────────────────

export function chunkText(
  text: string,
  chunkSize = 1500,
  overlap = 200
): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g) || [text];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length + sentence.length > chunkSize && current.length > 0) {
      chunks.push(current.trim());
      const words = current.split(/\s+/);
      const overlapWords = words.slice(-Math.ceil(overlap / 5));
      current = overlapWords.join(" ") + " " + sentence;
    } else {
      current += sentence;
    }
  }

  if (current.trim().length > 50) {
    chunks.push(current.trim());
  }

  return chunks;
}

// ── Entity & relationship extraction ────────────────────────────────────────

const EXTRACTION_PROMPT = `You are an expert at extracting structured knowledge from text.
Given a text chunk, extract all meaningful entities and their relationships.

Return ONLY valid JSON (no markdown fences, no explanation) with this exact schema:
{
  "entities": [
    {"name": "exact name", "type": "PERSON|ORGANIZATION|CONCEPT|TECHNOLOGY|EVENT|LOCATION|METRIC|OTHER", "description": "one-line description"}
  ],
  "relationships": [
    {"source": "entity name", "relation": "VERB_PHRASE", "target": "entity name", "description": "one-line context"}
  ]
}

Rules:
- Entity names should be normalized (title case, no abbreviations unless widely known)
- Relation should be an uppercase verb phrase (e.g. USES, DEVELOPED_BY, PART_OF, ENABLES)
- Every entity in a relationship must appear in the entities array
- Deduplicate: if the same entity appears multiple times, include it once
- Extract at least the most important entities even from short chunks
- If no meaningful entities exist, return {"entities":[],"relationships":[]}`;

function repairJSON(raw: string): string {
  let s = raw.trim();

  // Find the last complete JSON object in an array by locating the last "},"
  // or "}" that closes a valid object, then truncate after it.
  const lastCompleteObject = s.lastIndexOf("},");
  const lastClosedObject = s.lastIndexOf("}");

  if (lastCompleteObject > 0) {
    const afterCut = s.slice(0, lastCompleteObject + 1);
    const bracketOpen = (afterCut.match(/\[/g) || []).length;
    const bracketClose = (afterCut.match(/]/g) || []).length;
    const braceOpen = (afterCut.match(/{/g) || []).length;
    const braceClose = (afterCut.match(/}/g) || []).length;

    let repaired = afterCut;
    for (let i = 0; i < bracketOpen - bracketClose; i++) repaired += "]";
    for (let i = 0; i < braceOpen - braceClose; i++) repaired += "}";

    try {
      JSON.parse(repaired);
      return repaired;
    } catch { /* fall through to character-level repair */ }
  }

  // Character-level repair as fallback
  if (s.endsWith(",")) s = s.slice(0, -1);
  if (s.endsWith(":")) s = s.slice(0, -1);

  // Fix truncated strings
  const quotes = (s.match(/"/g) || []).length;
  if (quotes % 2 !== 0) s += '"';

  // Fix trailing key without value e.g. "key": or "key":"
  s = s.replace(/,\s*"[^"]*"\s*:\s*"?$/g, "");

  if (s.endsWith(",")) s = s.slice(0, -1);

  const braceOpen = (s.match(/{/g) || []).length;
  const braceClose = (s.match(/}/g) || []).length;
  const bracketOpen = (s.match(/\[/g) || []).length;
  const bracketClose = (s.match(/]/g) || []).length;

  for (let i = 0; i < bracketOpen - bracketClose; i++) s += "]";
  for (let i = 0; i < braceOpen - braceClose; i++) s += "}";

  return s;
}

export async function extractEntitiesFromChunk(
  chunk: string
): Promise<ExtractionResult> {
  const model = getModel();

  try {
    const response = await model.invoke([
      new SystemMessage(EXTRACTION_PROMPT),
      new HumanMessage(chunk.slice(0, 3000)),
    ]);

    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    const cleaned = content
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    let parsed: ExtractionResult;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.warn("[GraphRAG] Repairing truncated JSON response...");
      parsed = JSON.parse(repairJSON(cleaned));
    }

    if (!Array.isArray(parsed.entities)) parsed.entities = [];
    if (!Array.isArray(parsed.relationships)) parsed.relationships = [];

    return parsed;
  } catch (err) {
    console.error("Entity extraction failed for chunk:", err);
    return { entities: [], relationships: [] };
  }
}

// ── Graph construction ──────────────────────────────────────────────────────

export async function initGraphConstraints(): Promise<void> {
  await runCypher(
    "CREATE CONSTRAINT entity_name IF NOT EXISTS FOR (e:Entity) REQUIRE e.name IS UNIQUE"
  ).catch(() => {});

  await runCypher(
    "CREATE INDEX chunk_doc IF NOT EXISTS FOR (c:Chunk) ON (c.documentName)"
  ).catch(() => {});
}

export async function storeExtractionInGraph(
  extraction: ExtractionResult,
  chunk: string,
  documentName: string,
  chunkIndex: number
): Promise<void> {
  const chunkCypher = `
    MERGE (d:Document {name: $documentName})
    ON CREATE SET d.createdAt = timestamp()
    CREATE (c:Chunk {text: $text, documentName: $documentName, index: $chunkIndex, createdAt: timestamp()})
    MERGE (d)-[:CONTAINS]->(c)
    RETURN c
  `;
  await runCypher(chunkCypher, {
    documentName,
    text: chunk,
    chunkIndex,
  });

  for (const entity of extraction.entities) {
    const normalizedName = entity.name.trim();
    if (!normalizedName) continue;

    await runCypher(
      `
      MERGE (e:Entity {name: $name})
      ON CREATE SET e.type = $type, e.description = $description
      ON MATCH SET
        e.type = CASE WHEN e.type = 'OTHER' THEN $type ELSE e.type END,
        e.description = CASE WHEN size(e.description) < size($description) THEN $description ELSE e.description END
      WITH e
      MATCH (c:Chunk {documentName: $documentName, index: $chunkIndex})
      MERGE (c)-[:MENTIONS]->(e)
      `,
      {
        name: normalizedName,
        type: entity.type || "OTHER",
        description: entity.description || "",
        documentName,
        chunkIndex,
      }
    );
  }

  for (const rel of extraction.relationships) {
    const sourceName = rel.source.trim();
    const targetName = rel.target.trim();
    if (!sourceName || !targetName) continue;

    await runCypher(
      `
      MATCH (s:Entity {name: $source})
      MATCH (t:Entity {name: $target})
      MERGE (s)-[r:RELATES_TO {relation: $relation}]->(t)
      ON CREATE SET r.description = $description, r.weight = 1.0
      ON MATCH SET r.weight = r.weight + 0.5
      `,
      {
        source: sourceName,
        target: targetName,
        relation: rel.relation || "RELATED_TO",
        description: rel.description || "",
      }
    );
  }
}

export async function buildGraphFromDocument(
  text: string,
  documentName: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ entities: number; relationships: number; chunks: number }> {
  await initGraphConstraints();

  const chunks = chunkText(text);
  let totalEntities = 0;
  let totalRelationships = 0;

  for (let i = 0; i < chunks.length; i++) {
    const extraction = await extractEntitiesFromChunk(chunks[i]);
    await storeExtractionInGraph(extraction, chunks[i], documentName, i);

    totalEntities += extraction.entities.length;
    totalRelationships += extraction.relationships.length;

    onProgress?.(i + 1, chunks.length);
  }

  return {
    entities: totalEntities,
    relationships: totalRelationships,
    chunks: chunks.length,
  };
}

// ── Query-time entity extraction ────────────────────────────────────────────

const QUERY_ENTITY_PROMPT = `Extract the key entities and concepts from this user question.
Return ONLY a JSON array of strings — the entity names to search for in a knowledge graph.
Example: ["React", "state management", "hooks"]
No markdown fences, no explanation, just the JSON array.`;

export async function extractQueryEntities(
  query: string
): Promise<string[]> {
  const model = getModel();

  try {
    const response = await model.invoke([
      new SystemMessage(QUERY_ENTITY_PROMPT),
      new HumanMessage(query),
    ]);

    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    const cleaned = content
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return query
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5);
  }
}

// ── Graph retrieval ─────────────────────────────────────────────────────────

export async function queryGraph(
  query: string,
  documentName?: string
): Promise<GraphContext> {
  const entities = await extractQueryEntities(query);
  const lowerEntities = entities.map((e) => e.toLowerCase());
  console.log("[GraphRAG] Query entities:", entities);

  let factResults: { source: string; relation: string; target: string; description: string }[] = [];
  let chunkResults: { text: string }[] = [];
  let neighborResults: { source: string; relation: string; target: string }[] = [];

  if (lowerEntities.length > 0) {
    factResults = await runCypher<{
      source: string;
      relation: string;
      target: string;
      description: string;
    }>(
      `
      UNWIND $entities AS entityName
      MATCH (e:Entity)
      WHERE toLower(e.name) CONTAINS entityName
         OR entityName CONTAINS toLower(e.name)
      MATCH (e)-[r:RELATES_TO]-(related:Entity)
      WITH DISTINCT e.name AS source, r.relation AS relation, related.name AS target, r.description AS description, r.weight AS weight
      RETURN source, relation, target, description
      ORDER BY weight DESC
      LIMIT 30
      `,
      { entities: lowerEntities }
    );
    console.log("[GraphRAG] Facts found:", factResults.length);

    const docFilter = documentName
      ? "AND c.documentName = $documentName"
      : "";

    chunkResults = await runCypher<{ text: string }>(
      `
      UNWIND $entities AS entityName
      MATCH (c:Chunk)-[:MENTIONS]->(e:Entity)
      WHERE (toLower(e.name) CONTAINS entityName OR entityName CONTAINS toLower(e.name)) ${docFilter}
      RETURN DISTINCT c.text AS text
      LIMIT 8
      `,
      { entities: lowerEntities, documentName: documentName || "" }
    );
    console.log("[GraphRAG] Chunks via entities:", chunkResults.length);

    neighborResults = await runCypher<{
      source: string;
      relation: string;
      target: string;
    }>(
      `
      UNWIND $entities AS entityName
      MATCH (e:Entity)
      WHERE toLower(e.name) CONTAINS entityName
         OR entityName CONTAINS toLower(e.name)
      MATCH (e)-[:RELATES_TO]->(mid:Entity)-[r2:RELATES_TO]->(far:Entity)
      RETURN DISTINCT
        mid.name AS source,
        r2.relation AS relation,
        far.name AS target
      LIMIT 15
      `,
      { entities: lowerEntities }
    );
  }

  if (chunkResults.length === 0) {
    const keywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const keywordPattern = keywords.join("|");

    if (keywordPattern) {
      const docFilter = documentName
        ? "AND c.documentName = $documentName"
        : "";

      chunkResults = await runCypher<{ text: string }>(
        `
        MATCH (c:Chunk)
        WHERE any(kw IN $keywords WHERE toLower(c.text) CONTAINS kw) ${docFilter}
        RETURN c.text AS text
        LIMIT 6
        `,
        { keywords, documentName: documentName || "" }
      );
      console.log("[GraphRAG] Chunks via keyword fallback:", chunkResults.length);
    }
  }

  if (factResults.length === 0 && chunkResults.length === 0 && documentName) {
    console.log("[GraphRAG] No results from entity or keyword search, fetching all document data");

    factResults = await runCypher<{
      source: string;
      relation: string;
      target: string;
      description: string;
    }>(
      `
      MATCH (d:Document {name: $documentName})-[:CONTAINS]->(c:Chunk)-[:MENTIONS]->(e:Entity)
      MATCH (e)-[r:RELATES_TO]-(related:Entity)
      WITH DISTINCT e.name AS source, r.relation AS relation, related.name AS target, r.description AS description, r.weight AS weight
      RETURN source, relation, target, description
      ORDER BY weight DESC
      LIMIT 30
      `,
      { documentName }
    );

    chunkResults = await runCypher<{ text: string }>(
      `
      MATCH (d:Document {name: $documentName})-[:CONTAINS]->(c:Chunk)
      RETURN c.text AS text
      ORDER BY c.index
      LIMIT 8
      `,
      { documentName }
    );
    console.log("[GraphRAG] Document fallback — facts:", factResults.length, "chunks:", chunkResults.length);
  }

  const facts = factResults.map(
    (f) => `${f.source} --[${f.relation}]--> ${f.target}${f.description ? ` (${f.description})` : ""}`
  );

  const neighborFacts = neighborResults.map(
    (f) => `${f.source} --[${f.relation}]--> ${f.target}`
  );

  const allFacts = [...new Set([...facts, ...neighborFacts])];
  const chunks = chunkResults.map((c) => c.text);

  console.log("[GraphRAG] Final context — facts:", allFacts.length, "chunks:", chunks.length);

  return {
    facts: allFacts,
    chunks,
    entityCount: factResults.length,
    relationshipCount: allFacts.length,
  };
}

// ── Answer generation ───────────────────────────────────────────────────────

export async function generateAnswer(
  query: string,
  graphContext: GraphContext,
  history?: { role: string; content: string }[]
): Promise<string> {
  const model = getModel();

  const hasContext =
    graphContext.facts.length > 0 || graphContext.chunks.length > 0;

  let contextBlock = "";
  if (hasContext) {
    if (graphContext.facts.length > 0) {
      contextBlock += "## Knowledge Graph Facts\n";
      contextBlock += graphContext.facts.join("\n") + "\n\n";
    }
    if (graphContext.chunks.length > 0) {
      contextBlock += "## Relevant Document Passages\n";
      contextBlock += graphContext.chunks.join("\n---\n") + "\n";
    }
  }

  const systemPrompt = hasContext
    ? `You are a knowledgeable assistant. Use the following knowledge graph data and document passages to answer the user's question.

${contextBlock}

Instructions:
- Prioritize information from the knowledge graph and document passages
- If the provided context answers the question, base your response primarily on it
- If the context is insufficient, supplement with your general knowledge and note which parts come from the documents vs your knowledge
- Use clear Markdown formatting: **bold** for emphasis, bullet points for lists
- Be concise but thorough`
    : `You are a knowledgeable assistant. No specific document context was found for this question. Answer using your general knowledge. Use clear Markdown formatting.`;

  const messages: (SystemMessage | HumanMessage | AIMessage)[] = [
    new SystemMessage(systemPrompt),
  ];

  if (history && history.length > 0) {
    for (const msg of history) {
      if (msg.role === "user") {
        messages.push(new HumanMessage(msg.content));
      } else {
        messages.push(new AIMessage(msg.content));
      }
    }
  }

  messages.push(new HumanMessage(query));

  const response = await model.invoke(messages);

  const content =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  return content;
}
