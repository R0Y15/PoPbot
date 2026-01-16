import { v } from "convex/values";
import { mutation, action, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// Database mutations
export const getFile = mutation({
    args: { fileId: v.id("files") },
    async handler(ctx, args) {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Unauthenticated");

        const file = await ctx.db.get(args.fileId);
        if (!file) return null;

        if (file.ownerId !== identity.subject) {
            throw new Error("Unauthorized to access this file");
        }

        return file;
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
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Unauthenticated");

        return await ctx.db.insert("documents", {
            name: args.name,
            type: args.type,
            content: args.content,
            fileId: args.fileId,
            ownerId: identity.subject,
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
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) return [];

        return await ctx.db.query("documents")
            .filter(q => q.eq(q.field("ownerId"), identity.subject))
            .collect();
    },
});

export const getEmbeddings = query({
    args: {},
    async handler(ctx) {
        return await ctx.db.query("embeddings").collect();
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
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Unauthenticated");

        const MODEL_NAME = "gemini-2.5-flash-lite";
        try {
            console.log("Starting query with:", args.query);
            console.log("Gemini API Key prefix:", args.geminiApiKey ? args.geminiApiKey.substring(0, 5) : "MISSING");

            // Initialize Gemini

            // Using direct fetch to force API version 1 as requested
            const url = `https://generativelanguage.googleapis.com/v1/models/${MODEL_NAME}:generateContent?key=${args.geminiApiKey}`;

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

            console.log("Sending prompt to Gemini via v1 API");

            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{ text: prompt }]
                    }],
                    generationConfig: {
                        temperature: 0.5,
                        topP: 0.8,
                        topK: 32,
                        maxOutputTokens: 1024,
                    },
                    safetySettings: [
                        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                    ]
                })
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Gemini API Error: ${response.statusText} (${response.status}) - ${errorBody}`);
            }

            const data = await response.json();

            if (!data.candidates || data.candidates.length === 0) {
                throw new Error("No candidates returned from Gemini");
            }

            const candidate = data.candidates[0];
            const text = candidate.content?.parts?.[0]?.text;

            if (!text) {
                throw new Error("Empty text in response");
            }

            console.log("Generated response successfully");
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
