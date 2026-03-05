# POPBOT

A modern, AI chatbot powered by Google's Gemini model with GraphRAG knowledge retrieval, built with Next.js, Neo4j, Clerk, Convex, and shadcn/ui.

<div align="center">
  <img src="public/home-page.png" alt="AI Chatbot Demo" width="100%"/>
</div>

## Features

- 🤖 Powered by Google's Gemini AI model
- 🧠 GraphRAG-powered knowledge retrieval using Neo4j
- 🔐 User authentication with Clerk
- 💾 Real-time data sync with Convex
- 🎨 Beautiful UI with shadcn/ui components
- 📱 Responsive design
- 🔌 Easy to embed in any website
- ⚡ Real-time chat interactions

## Tech Stack

- **Framework**: Next.js 15
- **AI**: Google Gemini, LangChain
- **Knowledge Graph**: Neo4j (GraphRAG)
- **Auth**: Clerk
- **Database**: Convex
- **UI**: shadcn/ui, Tailwind CSS
- **Language**: TypeScript

## Getting Started

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env.local` file in the root directory and add your Gemini API key:
   ```
   NEXT_PUBLIC_GEMINI_API_KEY=your_api_key_here
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) to see the demo.

## Embedding the Chatbot

To embed the chatbot in your website, add the following iframe to your HTML:

```html
<iframe 
  src="https://embeddable-bot.vercel.app/widget"
  width="100%"
  height="600px"
  frameBorder="0"
/>
```

## Using the Chat Widget

The chat widget can be imported and used in any React component:

```jsx
import { ChatWidget } from '@/components/ChatWidget';

export default function YourPage() {
  return (
    <div>
      <h1>Your Page Content</h1>
      <ChatWidget />
    </div>
  );
}
```

## Document Limits

The app processes **one document at a time**. For best results:

| Document Size | Recommendation |
|---------------|----------------|
| **10-20 pages** | Optimal accuracy |
| **30-50 pages** | Acceptable |
| **50+ pages** | Split into sections |

### Technical constraints

- **Graph build timeout**: 60 seconds max processing time
- **Chunk size**: ~1500 characters per chunk
- **Context retrieval**: 8 chunks + 30 facts per query
- **Supported formats**: PDF, TXT, Markdown

For larger documents, split them into focused sections and upload one at a time.

## Development

- `src/components/Chatbot.tsx` - Main chatbot component
- `src/components/ChatWidget.tsx` - Floating chat widget
- `src/lib/gemini.ts` - Gemini AI configuration
- `src/lib/graph-rag.ts` - GraphRAG knowledge extraction
- `src/app/widget/page.tsx` - Embeddable widget page

## License

MIT
