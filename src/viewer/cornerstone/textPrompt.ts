import { create } from 'zustand';

interface TextPromptStore {
  pending?: { initial: string; resolve(text: string | undefined): void };
}

/** The open request for annotation text, shown by `TextPromptDialog`. */
export const useTextPromptStore = create<TextPromptStore>(() => ({}));

/** Asks the user for annotation text; resolves to undefined when cancelled. */
export function requestText(initial: string): Promise<string | undefined> {
  useTextPromptStore.getState().pending?.resolve(undefined);
  return new Promise((resolve) => {
    useTextPromptStore.setState({
      pending: {
        initial,
        resolve: (text) => {
          useTextPromptStore.setState({ pending: undefined });
          resolve(text?.trim() ? text.trim() : undefined);
        }
      }
    });
  });
}
