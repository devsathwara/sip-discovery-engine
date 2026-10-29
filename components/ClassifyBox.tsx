'use client';

import { useState } from 'react';
import { MAX_COMMENT_CHARS } from '@/lib/classify/limits';

type Label = {
  primary_gate: string;
  leaf: string;
  confidence: string;
  reasoning: string;
  quote: string;
  note: string;
};

export function ClassifyBox() {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [label, setLabel] = useState<Label | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    setLabel(null);
    try {
      const response = await fetch('/api/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const body = (await response.json()) as Label & { error?: string };
      if (!response.ok) {
        setError(body.error || 'The classifier could not label that comment.');
        return;
      }
      setLabel(body);
    } catch {
      setError('The classifier could not be reached.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="research" onSubmit={onSubmit}>
      <label>
        Comment
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value.slice(0, MAX_COMMENT_CHARS))}
          rows={5}
          maxLength={MAX_COMMENT_CHARS}
          required
          placeholder="I paused my SIP after the returns stayed flat"
        />
      </label>
      <p className="meta">
        {text.length.toLocaleString('en-IN')} / {MAX_COMMENT_CHARS.toLocaleString('en-IN')} characters. Longer comments are refused before the model is called.
      </p>
      <button type="submit" disabled={pending}>
        {pending ? 'Classifying…' : 'Classify'}
      </button>
      {error ? <p className="error">{error}</p> : null}
      {label ? (
        <div className="label-result">
          {label.note ? <p className="banner">{label.note}</p> : null}
          <dl>
            <div>
              <dt>primary_gate</dt>
              <dd>{label.primary_gate}</dd>
            </div>
            <div>
              <dt>leaf</dt>
              <dd>{label.leaf}</dd>
            </div>
            <div>
              <dt>confidence</dt>
              <dd>{label.confidence}</dd>
            </div>
            <div>
              <dt>quote</dt>
              <dd className="quote">{label.quote}</dd>
            </div>
            <div>
              <dt>reasoning</dt>
              <dd>{label.reasoning}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </form>
  );
}
