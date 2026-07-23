import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ConversationSummary } from '@hl/shared';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import { fetchConversations } from '../api/chat';
import { ErrorNotice } from '../components/ErrorNotice';
import { colors } from '../components/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Conversations'>;

function timeAgo(iso: string | null): string {
  if (iso === null) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function ConversationsScreen({ navigation }: Props) {
  const { accessToken } = useAuth();
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (accessToken === null) return;
    try {
      setConversations(await fetchConversations(accessToken));
    } catch {
      setError('Could not load your messages.');
    }
  }, [accessToken]);

  // Reload whenever the screen regains focus so unread counts stay current.
  useEffect(() => navigation.addListener('focus', () => void load()), [navigation, load]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Messages</Text>
      <ErrorNotice message={error} />

      {conversations !== null && conversations.length === 0 && (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            No conversations yet. Tap “Message” on a listing to start one.
          </Text>
        </View>
      )}

      {conversations?.map((c) => (
        <Pressable
          key={c.id}
          style={styles.row}
          onPress={() =>
            navigation.navigate('Conversation', {
              conversationId: c.id,
              counterpartName: c.counterpartName,
            })
          }
        >
          <View style={styles.rowText}>
            <View style={styles.rowHeader}>
              <Text style={styles.counterpart} numberOfLines={1}>
                {c.counterpartName}
              </Text>
              <Text style={styles.category} numberOfLines={1}>
                · {c.listingCategory}
              </Text>
            </View>
            <Text style={styles.preview} numberOfLines={1}>
              {c.lastMessagePreview ?? 'No messages yet'}
            </Text>
          </View>
          <View style={styles.rowMeta}>
            <Text style={styles.time}>{timeAgo(c.lastMessageAt)}</Text>
            {c.unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{c.unreadCount}</Text>
              </View>
            )}
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: 20, paddingTop: 64, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '700', color: colors.ink, marginBottom: 20 },
  emptyCard: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 20,
  },
  emptyText: { fontSize: 14, lineHeight: 21, color: `${colors.slate}B3` },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 16,
    marginBottom: 8,
  },
  rowText: { flex: 1 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  counterpart: { fontSize: 15, fontWeight: '600', color: colors.ink, flexShrink: 1 },
  category: { fontSize: 12, color: `${colors.slate}80`, flexShrink: 1 },
  preview: { fontSize: 13, color: `${colors.slate}B3`, marginTop: 4 },
  rowMeta: { alignItems: 'flex-end', gap: 4 },
  time: { fontSize: 11, color: `${colors.slate}80` },
  badge: { backgroundColor: colors.ink, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '700', color: colors.canvas },
});
