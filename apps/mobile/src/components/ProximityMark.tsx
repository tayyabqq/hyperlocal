import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from './theme';

/**
 * Concentric radius rings, matching the web mark. Drawn with views rather than
 * SVG to avoid pulling react-native-svg in for a single decorative element.
 */
export function ProximityMark({ size = 88 }: { size?: number }) {
  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <View style={[styles.ring, ringStyle(size, 1, colors.line)]} />
      <View style={[styles.ring, ringStyle(size, 0.68, colors.line)]} />
      <View style={[styles.ring, ringStyle(size, 0.38, colors.amber)]} />
      <View style={[styles.ring, ringStyle(size, 0.12, colors.ink, true)]} />
    </View>
  );
}

function ringStyle(size: number, scale: number, color: string, filled = false) {
  const d = size * scale;
  return {
    width: d,
    height: d,
    borderRadius: d / 2,
    borderWidth: filled ? 0 : 1.5,
    borderColor: color,
    backgroundColor: filled ? color : 'transparent',
  };
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute' },
});
