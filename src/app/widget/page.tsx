'use client';

import { Chatbot } from '@/components/Chatbot';

export default function WidgetPage() {
  return (
    <div className="h-dvh w-full flex items-end sm:items-center justify-center p-0 sm:p-4">
      <Chatbot className="h-dvh sm:h-[600px] rounded-none sm:rounded-lg" />
    </div>
  );
}
