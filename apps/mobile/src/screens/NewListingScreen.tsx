import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import * as Location from 'expo-location';
import * as WebBrowser from 'expo-web-browser';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CreateListingRequest } from '@hl/shared';
import { formatAed, LISTING_FEE_FILS } from '@hl/shared';
import type { RootStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import { createListing } from '../api/listings';
import { fetchCredits } from '../api/payments';
import { ApiError } from '../api/client';
import { Button } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { colors } from '../components/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'NewListing'>;

const DEIRA_DUBAI: [number, number] = [55.3095, 25.2697];

export function NewListingScreen({ navigation }: Props) {
  const { accessToken } = useAuth();

  const [pin, setPin] = useState<[number, number]>(DEIRA_DUBAI);
  const [category, setCategory] = useState('');
  const [payAmountAed, setPayAmountAed] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const { status: permission } = await Location.requestForegroundPermissionsAsync();
      if (permission !== 'granted') return;
      const position = await Location.getCurrentPositionAsync({});
      setPin([position.coords.longitude, position.coords.latitude]);
    })();
  }, []);

  // Drives the fee copy under the form. A failure here is not worth blocking
  // the form for — the wording just falls back to the standard fee.
  useEffect(() => {
    if (accessToken === null) return;
    fetchCredits(accessToken)
      .then((balance) => setCredits(balance.credits))
      .catch(() => setCredits(null));
  }, [accessToken]);

  async function onSubmit() {
    if (accessToken === null) return;
    setError(null);
    setBusy(true);
    try {
      const payload: CreateListingRequest = {
        category: category.trim(),
        payAmountAed: Number(payAmountAed),
        description: description.trim(),
        latitude: pin[1],
        longitude: pin[0],
        locationLabel: locationLabel.trim(),
      };
      const { order } = await createListing(accessToken, payload);

      // A card order opens the gateway's own page; a credit order is already
      // settled and goes straight to the confirmation screen.
      if (order.redirectUrl !== null) {
        await WebBrowser.openBrowserAsync(order.redirectUrl);
      }
      navigation.replace('PaymentPending', { orderId: order.id });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not post your listing.');
    } finally {
      setBusy(false);
    }
  }

  const hasCredit = credits !== null && credits > 0;

  const canSubmit =
    category.trim().length >= 2 &&
    Number(payAmountAed) >= 5 &&
    locationLabel.trim().length >= 2 &&
    description.trim().length >= 10;

  return (
    <View style={styles.screen}>
      <View style={styles.mapContainer}>
        <Mapbox.MapView
          style={styles.map}
          styleURL={Mapbox.StyleURL.Light}
          onPress={(feature: GeoJSON.Feature) => {
            if (feature.geometry.type !== 'Point') return;
            const [lng, lat] = feature.geometry.coordinates as [number, number];
            setPin([lng, lat]);
          }}
        >
          <Mapbox.Camera zoomLevel={13} centerCoordinate={pin} animationDuration={500} />
          <Mapbox.PointAnnotation id="picker" coordinate={pin}>
            <View style={styles.pickerPin} />
          </Mapbox.PointAnnotation>
        </Mapbox.MapView>
        <Text style={styles.mapHint}>Tap the map to set your exact location</Text>
      </View>

      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Post a listing</Text>
        <Text style={styles.subtitle}>Visible to nearby users for 7 days.</Text>

        <ErrorNotice message={error} />

        <Text style={styles.fieldLabel}>What&rsquo;s the job or skill?</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Warehouse helper"
          value={category}
          onChangeText={setCategory}
          maxLength={60}
        />

        <Text style={styles.fieldLabel}>Pay (AED)</Text>
        <TextInput
          style={styles.input}
          placeholder="120"
          keyboardType="number-pad"
          value={payAmountAed}
          onChangeText={setPayAmountAed}
        />

        <Text style={styles.fieldLabel}>Area name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Al Murar, Deira"
          value={locationLabel}
          onChangeText={setLocationLabel}
          maxLength={100}
        />

        <Text style={styles.fieldLabel}>Details</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="What's the work, when, and any requirements?"
          multiline
          numberOfLines={4}
          value={description}
          onChangeText={setDescription}
          maxLength={500}
        />

        <Text style={styles.feeNotice}>
          {hasCredit
            ? `Free — you have ${credits} listing credit${credits > 1 ? 's' : ''} left.`
            : `${formatAed(LISTING_FEE_FILS)} to post. Your listing goes live as soon as payment clears.`}
        </Text>

        <Button
          title={hasCredit ? 'Post listing' : `Pay ${formatAed(LISTING_FEE_FILS)} and post`}
          onPress={onSubmit}
          loading={busy}
          disabled={!canSubmit}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  mapContainer: { height: 240 },
  map: { flex: 1 },
  mapHint: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    backgroundColor: colors.white,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 11,
    color: colors.slate,
  },
  pickerPin: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.ink, borderWidth: 2, borderColor: colors.white },
  form: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: '700', color: colors.ink, marginBottom: 4 },
  subtitle: { fontSize: 13, color: `${colors.slate}B3`, marginBottom: 20 },
  fieldLabel: { fontSize: 14, fontWeight: '500', color: colors.slate, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
    borderRadius: 14,
    paddingHorizontal: 16,
    minHeight: 52,
    fontSize: 15,
    color: colors.ink,
    marginBottom: 16,
  },
  textArea: { minHeight: 90, textAlignVertical: 'top', paddingTop: 14 },
  feeNotice: { fontSize: 13, lineHeight: 19, color: `${colors.slate}B3`, marginBottom: 14 },
});
