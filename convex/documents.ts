import { v } from "convex/values";
import { mutation, action, query } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
// import { Pinecone } from "@pinecone-database/pinecone";
import * as GoogleGenAI from "@google/generative-ai";
import { api } from "./_generated/api";

// Define types for our documents
interface Document {
    _id: Id<"documents">;
    name: string;
    type: string;
    content: string;
    fileId: Id<"files">;
    ownerId: string;
    createdAt: number;
}

interface File {
    _id: Id<"files">;
    name: string;
    type: string;
    size: number;
    storageId: string;
    ownerId: string;
    createdAt: number;
}

interface Embedding {
    documentId: Id<"documents">;
    embedding: number[];
    chunk: string;
    createdAt: number;
}

interface RelevantChunk {
    chunk: string;
    score: number;
    documentId: Id<"documents">;
}

// Initialize Pinecone client
// const initPinecone = (apiKey: string) => {
//     return new Pinecone({
//         apiKey,
//     });
// };

// Initialize Gemini
const initGemini = (apiKey: string) => {
    return new GoogleGenAI.GoogleGenerativeAI(apiKey);
};

// Function to generate embeddings using a simple hash function
function simpleEmbedding(text: string): number[] {
    // Create a fixed-size embedding (32 dimensions)
    const embedding = new Array(32).fill(0);

    // Simple hash function to generate numbers between -1 and 1
    for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i);
        const position = i % 32;
        embedding[position] = (embedding[position] + Math.sin(charCode)) / 2;
    }

    return embedding;
}

export const generateEmbedding = action({
    args: { text: v.string() },
    async handler(ctx, args): Promise<number[]> {
        try {
            console.log("Generating embedding for text:", args.text.substring(0, 50) + "...");
            return simpleEmbedding(args.text);
        } catch (error) {
            console.error("Error generating embedding:", error);
            throw new Error("Failed to generate embedding");
        }
    },
});

// Text splitter function
function splitTextIntoChunks(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
    const chunks: string[] = [];
    let startIndex = 0;

    while (startIndex < text.length) {
        const endIndex = Math.min(startIndex + chunkSize, text.length);
        chunks.push(text.slice(startIndex, endIndex));
        startIndex = endIndex - overlap;
    }

    return chunks;
}

// Database mutations
export const getFile = mutation({
    args: { fileId: v.id("files") },
    async handler(ctx, args) {
        return await ctx.db.get(args.fileId);
    },
});

export const getFileUrl = mutation({
    args: { storageId: v.string() },
    async handler(ctx, args) {
        return await ctx.storage.getUrl(args.storageId);
    },
});

export const createDocument = mutation({
    args: {
        name: v.string(),
        type: v.string(),
        content: v.string(),
        fileId: v.id("files"),
    },
    async handler(ctx, args): Promise<Id<"documents">> {
        return await ctx.db.insert("documents", {
            name: args.name,
            type: args.type,
            content: args.content,
            fileId: args.fileId,
            ownerId: "public",
            createdAt: Date.now(),
        });
    },
});

export const storeEmbedding = mutation({
    args: {
        documentId: v.id("documents"),
        embedding: v.array(v.number()),
        chunk: v.string(),
    },
    async handler(ctx, args): Promise<void> {
        await ctx.db.insert("embeddings", {
            documentId: args.documentId,
            embedding: args.embedding,
            chunk: args.chunk,
            createdAt: Date.now(),
        });
    },
});

export const getDocuments = query({
    args: {},
    async handler(ctx) {
        return await ctx.db.query("documents").collect();
    },
});

export const getEmbeddings = query({
    args: {},
    async handler(ctx) {
        return await ctx.db.query("embeddings").collect();
    },
});

export const processFile = action({
    args: {
        fileId: v.id("files"),
        text: v.string(),
        geminiApiKey: v.string(),
        pineconeApiKey: v.string(),
    },
    async handler(ctx, args): Promise<Id<"documents">> {
        try {
            console.log("Starting file processing");

            // Get the file
            const file = await ctx.runMutation(api.documents.getFile, { fileId: args.fileId });
            if (!file) throw new Error("File not found");
            console.log("Processing file:", file.name, "type:", file.type);

            // Clean and normalize the text
            const cleanText = args.text
                .replace(/\s+/g, " ")  // Replace multiple spaces with single space
                .replace(/[^\w\s.,?!-]/g, " ")  // Keep only word chars, spaces, and basic punctuation
                .trim();

            if (!cleanText) {
                throw new Error("No text content to process");
            }

            console.log("Text length after cleaning:", cleanText.length);

            // Create document with full content
            const documentId = await ctx.runMutation(api.documents.createDocument, {
                name: file.name,
                type: file.type,
                content: cleanText,
                fileId: args.fileId,
            });
            console.log("Created document record");

            // Process in smaller chunks for better accuracy
            const chunks = splitTextIntoChunks(cleanText, 1000, 200);  // Increased chunk size for better context
            console.log(`Split content into ${chunks.length} chunks`);

            let embeddingCount = 0;
            let failedChunks = 0;

            // Process each chunk
            for (const chunk of chunks) {
                // Skip very small chunks
                if (chunk.trim().length < 50) {  // Increased minimum chunk size
                    console.log("Skipping small chunk");
                    continue;
                }

                try {
                    // Generate embedding
                    const embedding = await ctx.runAction(api.documents.generateEmbedding, {
                        text: chunk,
                    });

                    // Store embedding
                    if (embedding && embedding.length > 0) {
                        await ctx.runMutation(api.documents.storeEmbedding, {
                            documentId,
                            embedding,
                            chunk,
                        });
                        embeddingCount++;

                        if (embeddingCount % 5 === 0) {
                            console.log(`Progress: Created ${embeddingCount} embeddings`);
                        }
                    } else {
                        console.error("Empty embedding generated for chunk:", chunk.substring(0, 100));
                        failedChunks++;
                    }
                } catch (error) {
                    console.error("Error processing chunk:", error);
                    failedChunks++;
                }
            }

            console.log(`Successfully created ${embeddingCount} embeddings, failed: ${failedChunks}`);

            // Verify embeddings were created
            const embeddings = await ctx.runQuery(api.documents.getEmbeddings);
            const documentEmbeddings = embeddings.filter(e => e.documentId === documentId);

            if (documentEmbeddings.length === 0) {
                throw new Error("No embeddings were created for the document");
            }

            console.log(`Verified ${documentEmbeddings.length} embeddings for document`);
            return documentId;
        } catch (error) {
            console.error("Error in processFile:", error);
            throw error;
        }
    },
});

export const queryDocuments = action({
    args: {
        query: v.string(),
        context: v.optional(v.string()),
        geminiApiKey: v.string(),
        pineconeApiKey: v.string(),
    },
    async handler(ctx, args): Promise<{ text: string }> {
        const MODEL_NAME = "gemini-2.5-flash";
        try {
            console.log("Starting query with:", args.query);
            console.log("Gemini API Key prefix:", args.geminiApiKey ? args.geminiApiKey.substring(0, 5) : "MISSING");

            // Initialize Gemini

            const genAI = initGemini(args.geminiApiKey);
            const model = genAI.getGenerativeModel({
                model: MODEL_NAME,
                safetySettings: [
                    {
                        category: GoogleGenAI.HarmCategory.HARM_CATEGORY_HARASSMENT,
                        threshold: GoogleGenAI.HarmBlockThreshold.BLOCK_NONE
                    },
                    {
                        category: GoogleGenAI.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                        threshold: GoogleGenAI.HarmBlockThreshold.BLOCK_NONE
                    },
                    {
                        category: GoogleGenAI.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                        threshold: GoogleGenAI.HarmBlockThreshold.BLOCK_NONE
                    },
                    {
                        category: GoogleGenAI.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                        threshold: GoogleGenAI.HarmBlockThreshold.BLOCK_NONE
                    }
                ],
                generationConfig: {
                    temperature: 0.5,
                    topP: 0.8,
                    topK: 32,
                    maxOutputTokens: 1024,
                }
            });

            // Prepare prompt based on whether we have context
            let prompt = args.context ?
                `You are a knowledgeable assistant with access to the following document content:

Document Content:
${args.context}

First, analyze if this document content contains information relevant to answering the following question. If it does, use it as your primary source. If the document doesn't contain relevant information, inform the user and provide an answer based on your general knowledge.

User Question: ${args.query}

Please structure your response as follows:
1. If using document content: Start with "Based on the document..." and provide the answer.
2. If using general knowledge: Start with "The document doesn't contain information about this, but I can tell you that..." and provide the answer.
3. If using both: Clearly distinguish which parts come from the document and which are supplementary information from your knowledge.

Important formatting instructions:
- Use "**text**" for bold text (e.g., **Important Note:**)
- Use "* text" for bullet points (e.g., * First point)
- Ensure proper spacing after bullet points and between sections
- Use proper Markdown syntax for any lists, headings, or emphasis` :
                args.query;

            console.log("Sending prompt to Gemini");
            const result = await model.generateContent(prompt);
            if (!result) {
                throw new Error("Failed to generate content");
            }

            const response = await result.response;
            if (!response) {
                throw new Error("Empty response from AI");
            }

            const text = response.text();
            if (!text) {
                throw new Error("Empty text in response");
            }

            console.log("Generated response");
            return { text };
        } catch (error: any) {
            console.error("Error in queryDocuments:", error);
            console.error("Full error details:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
            // Provide more specific error messages based on the error type
            if (error instanceof Error) {
                if (error.message.includes("API key")) {
                    throw new Error("Invalid Gemini API key. Please check your API key in .env.local");
                } else if (error.message.includes("quota")) {
                    throw new Error("Gemini API quota exceeded. Please try again later or use a different API key");
                } else if (error.message.includes("model") || error.message.includes("not found")) {
                    throw new Error(`Gemini model '${MODEL_NAME}' not found or unavailable. Make sure your API key has access to this model. Details: ${error.message}`);
                } else {
                    throw new Error(`Failed to get response from AI: ${error.message}`);
                }
            }
            throw new Error(`Failed to get response from AI. Details: ${error}`);
        }
    }
});

// Helper function to compute cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
} 