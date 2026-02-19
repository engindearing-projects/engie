import React from 'react';
import { View, StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { colors } from '../theme/colors';
import type { Message } from '../types/gateway';

interface Props {
  message: Message;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user';

  return (
    <View style={[styles.container, isUser ? styles.userContainer : styles.assistantContainer]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        <Markdown style={isUser ? userMarkdownStyles : assistantMarkdownStyles}>
          {message.text}
        </Markdown>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    marginVertical: 4,
  },
  userContainer: {
    alignItems: 'flex-end',
  },
  assistantContainer: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  userBubble: {
    backgroundColor: colors.bgLight,
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: 'transparent',
    paddingHorizontal: 4,
  },
});

const baseMarkdown = {
  body: {
    color: colors.white,
    fontSize: 15,
    lineHeight: 22,
  },
  heading1: {
    color: colors.cyan,
    fontSize: 20,
    fontWeight: '700' as const,
    marginVertical: 8,
  },
  heading2: {
    color: colors.cyan,
    fontSize: 18,
    fontWeight: '600' as const,
    marginVertical: 6,
  },
  heading3: {
    color: colors.cyan,
    fontSize: 16,
    fontWeight: '600' as const,
    marginVertical: 4,
  },
  link: {
    color: colors.cyan,
    textDecorationLine: 'underline' as const,
  },
  strong: {
    color: colors.white,
    fontWeight: '700' as const,
  },
  em: {
    color: colors.gray,
    fontStyle: 'italic' as const,
  },
  code_inline: {
    backgroundColor: colors.codeBg,
    color: colors.cyan,
    fontFamily: 'Menlo',
    fontSize: 13,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  fence: {
    backgroundColor: colors.codeBg,
    color: colors.white,
    fontFamily: 'Menlo',
    fontSize: 13,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.codeBorder,
    marginVertical: 8,
  },
  blockquote: {
    backgroundColor: colors.bgLight,
    borderLeftColor: colors.cyan,
    borderLeftWidth: 3,
    paddingLeft: 12,
    paddingVertical: 4,
    marginVertical: 8,
  },
  bullet_list_icon: {
    color: colors.cyan,
  },
  ordered_list_icon: {
    color: colors.cyan,
  },
  list_item: {
    marginVertical: 2,
  },
  hr: {
    backgroundColor: colors.bgLighter,
    height: 1,
    marginVertical: 12,
  },
};

const userMarkdownStyles = {
  ...baseMarkdown,
  body: { ...baseMarkdown.body, color: colors.white },
};

const assistantMarkdownStyles = {
  ...baseMarkdown,
};
