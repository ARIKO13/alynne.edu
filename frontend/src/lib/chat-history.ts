/**
 * chat-history.ts — AI chat history persistence
 *
 * Stores multiple conversations in localStorage.
 * User can:
 *   - Create new conversation
 *   - Switch between conversations
 *   - Delete conversations
 *   - Search past conversations
 */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'alynne-chat-conversations';
const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES_PER_CONVERSATION = 100;

function loadConversations(): Conversation[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveConversations(conversations: Conversation[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    // Trim to max
    const trimmed = conversations.slice(0, MAX_CONVERSATIONS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('[ChatHistory] Save failed:', e);
  }
}

export function getAllConversations(): Conversation[] {
  return loadConversations().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getConversation(id: string): Conversation | null {
  return loadConversations().find((c) => c.id === id) || null;
}

export function createConversation(title?: string): Conversation {
  const conversations = loadConversations();
  const conv: Conversation = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: title || `Chat ${new Date().toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  conversations.push(conv);
  saveConversations(conversations);
  return conv;
}

export function addMessage(conversationId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>): void {
  const conversations = loadConversations();
  const conv = conversations.find((c) => c.id === conversationId);
  if (!conv) return;

  const fullMessage: ChatMessage = {
    ...message,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: Date.now(),
  };

  conv.messages.push(fullMessage);
  // Trim messages
  if (conv.messages.length > MAX_MESSAGES_PER_CONVERSATION) {
    conv.messages = conv.messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
  }
  conv.updatedAt = Date.now();

  // Auto-title from first user message
  if (conv.title.startsWith('Chat ') && message.role === 'user') {
    conv.title = message.content.substring(0, 40) + (message.content.length > 40 ? '...' : '');
  }

  saveConversations(conversations);
}

export function deleteConversation(id: string): void {
  const conversations = loadConversations().filter((c) => c.id !== id);
  saveConversations(conversations);
}

export function clearAllConversations(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

export function searchConversations(query: string): Conversation[] {
  const all = getAllConversations();
  if (!query.trim()) return all;
  const q = query.toLowerCase();
  return all.filter(
    (c) =>
      c.title.toLowerCase().includes(q) ||
      c.messages.some((m) => m.content.toLowerCase().includes(q))
  );
}

/**
 * Export conversation as markdown.
 */
export function exportConversationMarkdown(id: string): string {
  const conv = getConversation(id);
  if (!conv) return '';

  let md = `# ${conv.title}\n\n`;
  md += `Created: ${new Date(conv.createdAt).toLocaleString('id-ID')}\n\n`;
  md += `---\n\n`;

  for (const msg of conv.messages) {
    const role = msg.role === 'user' ? '**You**' : msg.role === 'assistant' ? '**AI**' : '**System**';
    md += `${role}\n\n${msg.content}\n\n---\n\n`;
  }

  return md;
}
