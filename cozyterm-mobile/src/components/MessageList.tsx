import React, { useRef } from 'react';
import { FlatList, View, StyleSheet } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { MessageBubble } from './MessageBubble';
import { StreamingIndicator } from './StreamingIndicator';
import { EngieBanner } from './EngieBanner';
import { colors } from '../theme/colors';
import type { Message } from '../types/gateway';

interface Props {
  messages: Message[];
  streamText: string;
  busy: boolean;
}

export function MessageList({ messages, streamText, busy }: Props) {
  const listRef = useRef<FlatList>(null);

  if (messages.length === 0 && !streamText && !busy) {
    return <EngieBanner />;
  }

  // Build display data: completed messages + streaming text
  const data = [...messages];
  const hasStream = streamText.length > 0;

  return (
    <FlatList
      ref={listRef}
      data={data}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <MessageBubble message={item} />}
      style={styles.list}
      contentContainerStyle={styles.content}
      onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
      onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
      ListFooterComponent={
        <>
          {hasStream && (
            <View style={styles.streamContainer}>
              <Markdown style={streamMarkdownStyles}>{streamText}</Markdown>
            </View>
          )}
          {busy && !hasStream && <StreamingIndicator />}
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  content: {
    paddingVertical: 8,
  },
  streamContainer: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
});

const streamMarkdownStyles = {
  body: {
    color: colors.gray,
    fontSize: 15,
    lineHeight: 22,
  },
  code_inline: {
    backgroundColor: colors.codeBg,
    color: colors.cyanDim,
    fontFamily: 'Menlo',
    fontSize: 13,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  fence: {
    backgroundColor: colors.codeBg,
    color: colors.gray,
    fontFamily: 'Menlo',
    fontSize: 13,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.codeBorder,
    marginVertical: 8,
  },
  strong: {
    color: colors.white,
    fontWeight: '700' as const,
  },
  link: {
    color: colors.cyanDim,
  },
};
