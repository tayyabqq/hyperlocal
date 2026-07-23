import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import * as Location from 'expo-location';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { UserRole, type ListingSummary } from '@hl/shared';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import { fetchNearbyListings } from '../api/listings';
import { startConversation } from '../api/chat';
import { ApiError } from '../api/client';
import { ErrorNotice } from '../components/ErrorNotice';
import { colors } from '../components/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Map'>;

const DEIRA_DUBAI: [number, number] = [55.3095, 25.2697]; // Mapbox order: [lng, lat]

export function MapScreen({ navigation }: Props) {
  const { status, accessToken, user } = useAuth();
  const [listings, setListings] = useState<ListingSummary[]>([]);
  const [center, setCenter] = useState<[number, number]>(DEIRA_DUBAI);
  const [selected, setSelected] = useState<ListingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messaging, setMessaging] = useState(false);

  async function openChat(listing: ListingSummary) {
    if (status !== 'authenticated' || accessToken === null) {
      navigation.navigate('Login');
      return;
    }
    setError(null);
    setMessaging(true);
    try {
      const conversation = await startConversation(accessToken, listing.id);
      setSelected(null);
      navigation.navigate('Conversation', {
        conversationId: conversation.id,
        counterpartName: conversation.counterpartName,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open a conversation.');
    } finally {
      setMessaging(false);
    }
  }

  async function load(lng: number, lat: number) {
    try {
      const result = await fetchNearbyListings(lat, lng);
      setListings(result.listings);
      setError(null);
    } catch {
      setError('Could not load nearby listings.');
    }
  }

  useEffect(() => {
    void load(center[0], center[1]);
  }, []);

  useEffect(() => {
    (async () => {
      const { status: permission } = await Location.requestForegroundPermissionsAsync();
      if (permission !== 'granted') return;
      const position = await Location.getCurrentPositionAsync({});
      const next: [number, number] = [position.coords.longitude, position.coords.latitude];
      setCenter(next);
      void load(next[0], next[1]);
    })();
  }, []);

  return (
    <View style={styles.screen}>
      <Mapbox.MapView style={styles.map} styleURL={Mapbox.StyleURL.Light}>
        <Mapbox.Camera zoomLevel={12} centerCoordinate={center} animationDuration={800} />
        {listings.map((listing) => (
          <Mapbox.PointAnnotation
            key={listing.id}
            id={listing.id}
            coordinate={[listing.longitude, listing.latitude]}
            onSelected={() => setSelected(listing)}
          >
            <View
              style={[
                styles.pin,
                { backgroundColor: listing.authorRole === UserRole.PROVIDER ? colors.amber : colors.signal },
              ]}
            />
          </Mapbox.PointAnnotation>
        ))}
      </Mapbox.MapView>

      <View style={styles.topBar}>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{listings.length} nearby</Text>
        </View>
        <Pressable
          style={styles.postButton}
          onPress={() => navigation.navigate(status === 'authenticated' ? 'NewListing' : 'Login')}
        >
          <Text style={styles.postButtonText}>Post a listing</Text>
        </Pressable>
      </View>

      {error !== null && (
        <View style={styles.errorWrap}>
          <ErrorNotice message={error} />
        </View>
      )}

      {selected !== null && (
        <View style={styles.sheet}>
          <View style={styles.sheetHeaderRow}>
            <View style={styles.sheetHeaderText}>
              <Text style={styles.sheetTitle}>{selected.category}</Text>
              <Text style={styles.sheetSubtitle}>{selected.locationLabel}</Text>
              <Text style={styles.sheetAuthor}>Posted by {selected.authorDisplayName}</Text>
            </View>
            <Text style={styles.sheetPay}>AED {selected.payAmountAed}</Text>
          </View>
          <Text style={styles.sheetDescription}>{selected.description}</Text>
          {selected.authorId !== user?.id && (
            <Pressable
              style={[styles.messageButton, messaging && styles.messageButtonDisabled]}
              disabled={messaging}
              onPress={() => void openChat(selected)}
            >
              <Text style={styles.messageButtonText}>
                {messaging ? 'Opening…' : `Message ${selected.authorDisplayName}`}
              </Text>
            </Pressable>
          )}
          <Pressable onPress={() => setSelected(null)}>
            <Text style={styles.sheetClose}>Close</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  map: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: 56,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  countBadge: { backgroundColor: colors.white, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  countText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  postButton: { backgroundColor: colors.amber, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 10 },
  postButtonText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  pin: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.white },
  errorWrap: { position: 'absolute', top: 108, left: 16, right: 16 },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
  },
  sheetHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  sheetHeaderText: { flex: 1, paddingRight: 12 },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: colors.ink },
  sheetSubtitle: { fontSize: 13, color: `${colors.slate}B3`, marginTop: 2 },
  sheetAuthor: { fontSize: 11, color: `${colors.slate}80`, marginTop: 4 },
  sheetPay: { fontSize: 16, fontWeight: '700', color: colors.amber },
  sheetDescription: { fontSize: 14, color: colors.slate, marginBottom: 16 },
  messageButton: {
    backgroundColor: colors.ink,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  messageButtonDisabled: { opacity: 0.5 },
  messageButtonText: { color: colors.canvas, fontSize: 15, fontWeight: '600' },
  sheetClose: { fontSize: 13, color: `${colors.slate}80`, textAlign: 'center' },
});
