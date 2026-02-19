import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { colors } from '../theme/colors';
import styles from './StreamingIndicator.module.css';

interface Props {
  text: string;
}

export function StreamingIndicator({ text }: Props) {
  if (!text) return null;

  return (
    <div className={styles.container}>
      <div className={styles.content} style={{ color: colors.white }}>
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
          {text}
        </ReactMarkdown>
        <span className={styles.cursor} style={{ backgroundColor: colors.cyan }} />
      </div>
    </div>
  );
}
