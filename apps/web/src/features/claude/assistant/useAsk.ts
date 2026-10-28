// One question at a time to the assistant (Claude features spec, section 3.3). While Claude
// answers, the question shows with Stop; the answer then lands in its chat, which a new chat's
// first answer creates. Closing the panel or switching the Assistant off stops the question (CL-05).
import type {
  AskRequest,
  AssistantPageLink,
  ChatListResponse,
  ChatResponse,
} from '@carehub/extras/claude/assistant';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { WriteProblem } from '../write/api';
import { askAssistant, askProblem, AskStopped, chatKey, chatsKey } from './api';
import { showChat } from './panel-state';

export interface Asking {
  request: AskRequest;
  /** The @ pages with their titles, shown with the question while it waits. */
  pages: AssistantPageLink[];
  /** Why the question failed; it stays on show with Try again when that may help. */
  problem: WriteProblem | null;
}

export interface Ask {
  /** The question on its way, or the one that failed. */
  asking: Asking | null;
  /** True while Claude answers. */
  waiting: boolean;
  /** The last finished answer in Markdown, for screen readers. */
  answered: string | null;
  send: (request: AskRequest, pages: AssistantPageLink[]) => void;
  /** Sends the failed question again. */
  retry: () => void;
  /** Stops the question, or puts a failed one away, and gives it back for the question box. */
  stop: () => Asking | null;
}

export function useAsk(person: string): Ask {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<Asking | null>(null);
  const [answered, setAnswered] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const latest = useRef<Asking | null>(null);

  const show = useCallback((next: Asking | null) => {
    latest.current = next;
    setAsking(next);
  }, []);

  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
    },
    [],
  );

  const send = useCallback(
    (request: AskRequest, pages: AssistantPageLink[]) => {
      controller.current?.abort();
      const mine = new AbortController();
      controller.current = mine;
      show({ request, pages, problem: null });
      askAssistant(request, { signal: mine.signal }).then(
        ({ chat, question, answer }) => {
          if (controller.current !== mine) return;
          controller.current = null;
          const key = chatKey(person, chat.id);
          const cached = queryClient.getQueryData<ChatResponse>(key);
          if (cached || !request.chatId) {
            queryClient.setQueryData<ChatResponse>(key, {
              chat,
              messages: [...(cached?.messages ?? []), question, answer],
            });
          } else {
            void queryClient.invalidateQueries({ queryKey: key });
          }
          queryClient.setQueryData<ChatListResponse>(chatsKey(person), (list) =>
            list ? { chats: [chat, ...list.chats.filter(({ id }) => id !== chat.id)] } : list,
          );
          void queryClient.invalidateQueries({ queryKey: chatsKey(person) });
          // One render: the chat with its answer, never the answer twice or a blank chat between.
          showChat(chat.id);
          flushSync(() => {
            show(null);
            setAnswered(answer.text);
          });
        },
        (error: unknown) => {
          if (controller.current !== mine || error instanceof AskStopped) return;
          controller.current = null;
          if (request.chatId) {
            void queryClient.invalidateQueries({ queryKey: chatKey(person, request.chatId) });
          }
          show({ request, pages, problem: askProblem(error) });
        },
      );
    },
    [person, queryClient, show],
  );

  const retry = useCallback(() => {
    const failed = latest.current;
    if (failed?.problem) send(failed.request, failed.pages);
  }, [send]);

  const stop = useCallback(() => {
    const stopped = latest.current;
    controller.current?.abort();
    controller.current = null;
    show(null);
    return stopped;
  }, [show]);

  return {
    asking,
    waiting: asking !== null && asking.problem === null,
    answered,
    send,
    retry,
    stop,
  };
}
