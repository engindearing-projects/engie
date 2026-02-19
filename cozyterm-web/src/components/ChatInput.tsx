import { useState, useRef, useCallback, type KeyboardEvent, type ChangeEvent } from 'react';
import { colors } from '../theme/colors';
import styles from './ChatInput.module.css';

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, disabled }: Props) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      adjustHeight();
    },
    [adjustHeight],
  );

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    // Reset textarea height after clearing
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    });
  }, [text, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const canSend = text.trim().length > 0 && !disabled;

  return (
    <div className={styles.container} style={{ backgroundColor: colors.bg }}>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        style={{
          backgroundColor: colors.bgLight,
          color: colors.white,
        }}
        placeholder="Message Engie..."
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        rows={1}
      />
      <button
        className={styles.sendButton}
        style={{
          backgroundColor: canSend ? colors.cyan : colors.bgLighter,
          color: canSend ? colors.bg : colors.grayDim,
        }}
        onClick={handleSend}
        disabled={!canSend}
        aria-label="Send message"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </div>
  );
}
