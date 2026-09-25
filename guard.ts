import type { ChatMessage } from '../../src/help/ai.ts';

const LIMITS = { systemChars: 24_000, messages: 12, messageChars: 4_000 };

/**
 * Prepended to every request, server-side. The client supplies the help
 * articles and context, but can't turn this endpoint into a free
 * general-purpose chatbot.
 */
export const GUARD = `You are only the help desk for Tally, a personal-finance web app. Answer only questions about using Tally, or general personal-money concepts that relate to it (subscriptions, splitting costs, sales tax, budgeting, exchange rates). For anything else (writing code, essays, homework, other products), reply briefly that you can only help with Tally. Keep answers under 200 words.

`;

export function validate(body: unknown): { system: string; messages: ChatMessage[] } | string {
  if (typeof body !== 'object' || body === null) return 'Expected a JSON object.';
  const { system, messages } = body as { system?: unknown; messages?: unknown };
  if (typeof system !== 'string' || system.length > LIMITS.systemChars) return 'Invalid or oversized system prompt.';
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > LIMITS.messages) return 'Invalid messages.';
  for (const m of messages) {
    if (typeof m !== 'object' || m === null) return 'Invalid message.';
    const { role, content } = m as { role?: unknown; content?: unknown };
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string' || !content.trim() || content.length > LIMITS.messageChars) {
      return 'Invalid message.';
    }
  }
  if ((messages.at(-1) as ChatMessage).role !== 'user') return 'The last message must be from the user.';
  return { system, messages: messages as ChatMessage[] };
}
