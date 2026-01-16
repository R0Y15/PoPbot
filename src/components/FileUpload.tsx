'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, File, Loader2, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { cn } from '@/lib/utils';

interface FileInfo {
  id: Id<"files">;
  name: string;
  content: string;
}

async function extractTextFromPDF(file: File): Promise<string> {
  try {
    console.log('Starting PDF extraction for file:', file.name);
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/parse-pdf', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('PDF extraction failed:', errorData);
      throw new Error(errorData.error || `Server error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!data || !data.text) {
      console.error('Invalid response data:', data);
      throw new Error('No text content found in PDF');
    }

    console.log('PDF extraction successful, text length:', data.text.length);
    console.log('First 100 characters:', data.text.substring(0, 100));
    return data.text;
  } catch (error) {
    console.error('PDF extraction error:', error);
    throw error;
  }
}

async function extractText(file: File): Promise<string> {
  console.log('Extracting text from file:', file.type);
  
  if (file.type === 'application/pdf') {
    console.log('Extracting text from PDF');
    return await extractTextFromPDF(file);
  } else if (file.type === 'text/plain' || file.type === 'text/markdown') {
    console.log('Reading text file directly');
    return await file.text();
  } else {
    throw new Error(`Unsupported file type: ${file.type}`);
  }
}

interface FileUploadProps {
  onFileContent: (content: string | null, fileName: string | null) => void;
  onGraphStatus?: (status: 'idle' | 'building' | 'ready' | 'error', documentName?: string) => void;
}

export function FileUpload({ onFileContent, onGraphStatus }: FileUploadProps) {
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const [deleting, setDeleting] = useState<Id<"files"> | null>(null);
  const [currentFile, setCurrentFile] = useState<FileInfo | null>(null);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const createFile = useMutation(api.files.createFile);
  const deleteFile = useMutation(api.files.deleteFile);

  const handleDelete = async (fileId: Id<"files">) => {
    try {
      setDeleting(fileId);
      await deleteFile({ fileId });
      setCurrentFile(null);
      onFileContent(null, null);
      toast({
        title: "Success",
        description: "File deleted successfully",
      });
    } catch (error: any) {
      console.error("Error deleting file:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete file",
        variant: "destructive",
      });
    } finally {
      setDeleting(null);
    }
  };

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;

      const file = acceptedFiles[0];
      setIsUploading(true);

      try {
        let text = '';
        if (file.type === 'application/pdf') {
          text = await extractTextFromPDF(file);
        } else if (
          file.type === 'text/plain' ||
          file.type === 'text/markdown' ||
          file.type.startsWith('text/')
        ) {
          text = await file.text();
        } else {
          throw new Error('Unsupported file type. Please upload a PDF or text file.');
        }

        if (!text.trim()) {
          throw new Error('No text content found in file');
        }

        console.log('Extracted text length:', text.length);
        onFileContent(text, file.name);

        onGraphStatus?.('building', file.name);
        toast({
          title: 'Building knowledge graph...',
          description: 'Extracting entities and relationships from the document',
        });

        try {
          const graphRes = await fetch('/api/graph/build', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, documentName: file.name }),
          });

          if (!graphRes.ok) {
            const errData = await graphRes.json();
            throw new Error(errData.error || 'Graph build failed');
          }

          const graphData = await graphRes.json();
          onGraphStatus?.('ready', file.name);
          toast({
            title: 'Knowledge graph ready',
            description: `Extracted ${graphData.stats.entities} entities and ${graphData.stats.relationships} relationships from ${graphData.stats.chunks} chunks`,
          });
        } catch (graphErr) {
          console.error('Graph build error:', graphErr);
          onGraphStatus?.('error', file.name);
          toast({
            title: 'Graph build failed',
            description: 'Chat will use document text directly as fallback',
            variant: 'destructive',
          });
        }
      } catch (error) {
        console.error('File processing error:', error);
        onFileContent(null, null);
        toast({
          title: 'Error',
          description: error instanceof Error ? error.message : 'Failed to process file',
          variant: 'destructive',
        });
      } finally {
        setIsUploading(false);
      }
    },
    [onFileContent, toast]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'text/plain': ['.txt'],
      'text/markdown': ['.md'],
    },
    maxFiles: 1,
  });

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={cn(
          'p-4 border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors',
          isDragActive ? 'border-primary bg-primary/10' : 'border-muted-foreground/25',
          isUploading && 'opacity-50 cursor-not-allowed'
        )}
      >
        <input {...getInputProps()} />
        {isUploading ? (
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <p className="text-sm">Processing file...</p>
          </div>
        ) : isDragActive ? (
          <p className="text-sm">Drop the file here...</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Drag & drop a file here, or click to select
          </p>
        )}
      </div>

      {currentFile && (
        <Card className="p-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <File className="h-6 w-6 text-muted-foreground" />
            <div>
              <p className="font-medium">{currentFile.name}</p>
              <p className="text-sm text-muted-foreground">
                {currentFile.content.length} characters
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleDelete(currentFile.id)}
            disabled={deleting === currentFile.id}
          >
            {deleting === currentFile.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 text-destructive" />
            )}
          </Button>
        </Card>
      )}
    </div>
  );
} 