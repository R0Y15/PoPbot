'use client';

import { useState, useCallback, useRef, useEffect } from "react";
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useToast } from '../hooks/use-toast';
import { chat, graphChat } from '@/lib/gemini';
import { FileUpload } from './FileUpload';
import { useConvex } from 'convex/react';
import { Loader2, Paperclip, X, GitGraph } from 'lucide-react';
import { cn } from "@/lib/utils";
import ReactMarkdown from 'react-markdown';

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

export function Chatbot({ className }: { className?: string }) {
    const [messages, setMessages] = useState<Message[]>([
        {
            role: "assistant",
            content: "**Welcome!** 👋\n\n* I'm your AI assistant, How can I help you today?\n* Feel free to ask me anything about the uploaded documents or general questions!"
        }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [documentContent, setDocumentContent] = useState<string | null>(null);
    const [showUpload, setShowUpload] = useState(false);
    const [currentFileName, setCurrentFileName] = useState<string | null>(null);
    const [graphStatus, setGraphStatus] = useState<'idle' | 'building' | 'ready' | 'error'>('idle');
    const [graphDocumentName, setGraphDocumentName] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();
    const convex = useConvex();

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const userMessage = input;
        setInput("");
        setMessages((prev) => [...prev, { role: "user", content: userMessage }]);

        setIsLoading(true);
        try {
            const recentHistory = messages.slice(-6).map((m) => ({
                role: m.role,
                content: m.role === 'assistant' ? m.content.slice(0, 500) : m.content,
            }));

            const response = graphStatus === 'ready' && graphDocumentName
                ? await graphChat(userMessage, graphDocumentName, recentHistory)
                : await chat(userMessage, convex, documentContent);
            setMessages((prev) => [
                ...prev,
                { role: "assistant", content: response.text },
            ]);
        } catch (error) {
            console.error("Error getting AI response:", error);
            setMessages((prev) => [
                ...prev,
                {
                    role: "assistant",
                    content: "Sorry, I encountered an error. Please try again.",
                },
            ]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleFileContent = useCallback((content: string | null, fileName: string | null) => {
        setDocumentContent(content);
        setCurrentFileName(fileName);
        setShowUpload(false);
    }, []);

    const handleGraphStatus = useCallback((status: 'idle' | 'building' | 'ready' | 'error', docName?: string) => {
        setGraphStatus(status);
        if (docName) setGraphDocumentName(docName);
    }, []);

    const handleDeleteFile = useCallback(() => {
        setDocumentContent(null);
        setCurrentFileName(null);
        setGraphStatus('idle');
        setGraphDocumentName(null);
    }, []);

    return (
        <Card className={cn("w-full max-w-2xl mx-4 sm:mx-auto h-[600px] flex flex-col rounded-t-none bg-background", className)}>
            <div className="p-4 border-b bg-background">
                <h2 className="font-semibold text-foreground">AI Chat Assistant</h2>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-background">
                {messages.map((message, index) => (
                    <div
                        key={index}
                        className={cn(
                            "flex flex-col rounded-lg px-3 py-1.5 text-sm",
                            message.role === "user"
                                ? "bg-primary text-primary-foreground ml-auto w-fit max-w-[80%]"
                                : "bg-muted dark:bg-secondary/80 text-foreground dark:text-foreground prose prose-sm max-w-[80%] prose-p:my-0 prose-ul:my-0 prose-ul:pl-4 dark:prose-invert"
                        )}
                    >
                        {message.role === "user" ? (
                            <div>{message.content}</div>
                        ) : (
                            <ReactMarkdown className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{message.content}</ReactMarkdown>
                        )}
                    </div>
                ))}
                {isLoading && (
                    <div className="flex items-center space-x-2">
                        <Loader2 className="h-4 w-4 animate-spin text-foreground" />
                        <p className="text-sm text-muted-foreground">AI is thinking...</p>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {currentFileName && (
                <div className="mx-4 mb-2 px-3 py-1.5 bg-muted dark:bg-secondary/80 rounded-md flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">{currentFileName}</span>
                        {graphStatus === 'building' && (
                            <span className="flex items-center gap-1 text-xs text-amber-500">
                                <Loader2 className="h-3 w-3 animate-spin" /> Building graph...
                            </span>
                        )}
                        {graphStatus === 'ready' && (
                            <span className="flex items-center gap-1 text-xs text-emerald-500">
                                <GitGraph className="h-3 w-3" /> Graph ready
                            </span>
                        )}
                        {graphStatus === 'error' && (
                            <span className="text-xs text-destructive">Graph failed — using fallback</span>
                        )}
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={handleDeleteFile}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            )}

            {showUpload && (
                <div className="mx-4 mb-2">
                    <FileUpload onFileContent={handleFileContent} onGraphStatus={handleGraphStatus} />
                </div>
            )}

            <form onSubmit={handleSubmit} className="p-4 flex gap-2 items-center justify-center bg-background border-t">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="flex-none"
                    onClick={() => setShowUpload(!showUpload)}
                >
                    <Paperclip className="h-5 w-5" />
                </Button>
                <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type your message..."
                    className="flex-1"
                />
                <Button type="submit" disabled={isLoading || !input.trim()}>
                    {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        "Send"
                    )}
                </Button>
            </form>
        </Card>
    );
}