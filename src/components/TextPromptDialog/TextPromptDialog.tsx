import { useEffect, useState } from 'react';
import { useTextPromptStore } from '../../viewer/cornerstone/textPrompt';

/** Asks for the text of an arrow annotation. */
export function TextPromptDialog(): JSX.Element | null {
  const pending = useTextPromptStore((state) => state.pending);
  const [text, setText] = useState('');
  useEffect(() => setText(pending?.initial ?? ''), [pending]);
  if (!pending) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => pending.resolve(undefined)}>
      <form
        className="annotation-editor annotation-dialog"
        role="dialog"
        aria-label="Annotation text"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => { event.preventDefault(); pending.resolve(text); }}
      >
        <input
          autoFocus
          value={text}
          placeholder="Annotation"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Escape') pending.resolve(undefined); }}
        />
        <button type="submit">Add</button>
      </form>
    </div>
  );
}
