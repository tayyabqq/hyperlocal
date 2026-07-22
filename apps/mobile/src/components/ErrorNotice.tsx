import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';

export function ErrorNotice({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <View style={styles.box} accessibilityRole="alert">
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: '#FBEAE3',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  text: { color: colors.danger, fontSize: 13, lineHeight: 18 },
});
