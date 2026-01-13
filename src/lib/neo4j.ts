import neo4j, { Driver, Session } from "neo4j-driver";

let driver: Driver | null = null;

function getDriver(): Driver {
  if (driver) return driver;

  const uri = process.env.NEO4J_URI;
  const user = process.env.NEO4J_USERNAME;
  const password = process.env.NEO4J_PASSWORD;

  if (!uri || !user || !password) {
    throw new Error(
      "Missing Neo4j credentials. Set NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD in .env.local"
    );
  }

  driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  return driver;
}

export function getSession(): Session {
  return getDriver().session();
}

export async function runCypher<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const session = getSession();
  try {
    const result = await session.run(cypher, params);
    return result.records.map((r) => r.toObject() as T);
  } finally {
    await session.close();
  }
}

export async function verifyConnection(): Promise<boolean> {
  try {
    await runCypher("RETURN 1 AS ok");
    return true;
  } catch {
    return false;
  }
}
