import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Socket } from 'socket.io-client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MESSAGE_MAX_LENGTH, type ChatMessage } from '@hl/shared';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import { fetchMessages, markConversationRead, sendMessageRest } from '../api/chat';
import { connectChatSocket, sendMessageSocket, sendReadSocket } from '../api/chat-socket';
import { ApiError } from '../api/client';
import { ErrorNotice } from '../components/ErrorNotice';
import { colors } from '../components/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Conversation'>;

export function ConversationScreen({ route }: Props) {
  const { conversationId, counterpartName } = route.params;
  const { accessToken, user } = useAuth();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const appendUnique = useCallback((incoming: ChatMessage) => {
    setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
  }, []);

  useEffect(() => {
    if (accessToken === null) return;
    let active = true;

    void fetchMessages(accessToken, conversationId)
      .then((res) => {
        if (active) setMessages(res.messages);
      })
      .catch(() => setError('Could not load this conversation.'));

    void markConversationRead(accessToken, conversationId).catch(() => undefined);

    const socket = connectChatSocket(accessToken, {
      onMessage: (m) => {
        if (m.conversationId !== conversationId) return;
        appendUnique(m);
        // The thread is open, so a message from the other side is read on arrival.
        if (m.senderId !== user?.id) sendReadSocket(socket, conversationId);
      },
      onRead: () => undefined,
      onError: (msg) => setError(msg),
    });
    socketRef.current = socket;

    return () => {
      active = false;
      socket.disconnect();
      socketRef.current = null;
    };
  }, [accessToken, conversationId, appendUnique, user?.id]);

  const onSend = useCallback(async () => {
    const body = draft.trim();
    if (body.length === 0 || accessToken === null) return;
    setError(null);
    setDraft('');

    const socket = socketRef.current;
    if (socket?.connected) {
      sendMessageSocket(socket, conversationId, body);
      return;
    }

    // No live socket — REST fallback so a flaky connection never loses a message.
    setSending(true);
    try {
      appendUnique(await sendMessageRest(accessToken, conversationId, body));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send your message.');
      setDraft(body);
    } finally {
      setSending(false);
    }
  }, [draft, accessToken, conversationId, appendUnique]);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{counterpartName}</Text>
      </View>

      <ErrorNotice message={error} />

      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => {
          const mine = item.senderId === user?.id;
          return (
            <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                <Text style={mine ? styles.bubbleTextMine : styles.bubbleTextTheirs}>
                  {item.body}
                </Text>
              </View>
            </View>
          );
        }}
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Write a message…"
          maxLength={MESSAGE_MAX_LENGTH}
          multiline
        />
        <Pressable
          style={[styles.sendButton, draft.trim().length === 0 && styles.sendDisabled]}
          disabled={sending || draft.trim().length === 0}
          onPress={onSend}
        >
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: {
    paddingTop: 56,
    paddingBottom: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.white,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  list: { flex: 1 },
  listContent: { padding: 16, gap: 8 },
  bubbleRow: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  bubbleMine: { backgroundColor: colors.ink },
  bubbleTheirs: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  bubbleTextMine: { color: colors.canvas, fontSize: 14, lineHeight: 20 },
  bubbleTextTheirs: { color: colors.ink, fontSize: 14, lineHeight: 20 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.white,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.ink,
  },
  sendButton: {
    backgroundColor: colors.ink,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  sendDisabled: { opacity: 0.5 },
  sendText: { color: colors.canvas, fontSize: 14, fontWeight: '600' },
});
