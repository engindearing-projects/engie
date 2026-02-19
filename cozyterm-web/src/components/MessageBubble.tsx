import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { colors } from '../theme/colors';
import type { Message } from '../types/gateway';
import styles from './MessageBubble.module.css';

interface Props {
  message: Message;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user';

  return (
    <div className={`${styles.row} ${isUser ? styles.rowUser : styles.rowAssistant}`}>
      <div
        className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleAssistant}`}
        style={{
          backgroundColor: isUser ? colors.bgLight : 'transparent',
          color: colors.white,
        }}
      >
        {isUser ? (
          <span>{message.text}</span>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h1 style={{ color: colors.cyan }}>{children}</h1>,
              h2: ({ children }) => <h2 style={{ color: colors.cyan }}>{children}</h2>,
              h3: ({ children }) => <h3 style={{ color: colors.cyan }}>{children}</h3>,
              h4: ({ children }) => <h4 style={{ color: colors.cyan }}>{children}</h4>,
              h5: ({ children }) => <h5 style={{ color: colors.cyan }}>{children}</h5>,
              h6: ({ children }) => <h6 style={{ color: colors.cyan }}>{children}</h6>,
              pre: ({ children }) => (
                <pre style={{ backgroundColor: colors.codeBg, border: `1px solid ${colors.codeBorder}` }}>
                  {children}
                </pre>
              ),
              blockquote: ({ children }) => (
                <blockquote style={{ borderLeftColor: colors.bgLighter, color: colors.gray }}>
                  {children}
                </blockquote>
              ),
              th: ({ children }) => (
                <th style={{ borderBottom: `1px solid ${colors.bgLighter}`, color: colors.gray }}>
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td style={{ borderBottom: `1px solid ${colors.bgLighter}` }}>
                  {children}
                </td>
              ),
              hr: () => <hr style={{ backgroundColor: colors.bgLighter }} />,
            }}
          >
            {message.text}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}
