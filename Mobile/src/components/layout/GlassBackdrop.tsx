import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

/**
 * The soft aurora the glass surfaces sit on: a pale mist with four colour pools (the brand's navy, a teal, a green and a touch of
 * sand). Drawn with a gradient and radial gradients, so it needs no native blur module. It fills its parent, ignores touches and is
 * meant to be the first child of a screen; see GlassSafeArea, which puts it there.
 */
export function GlassBackdrop() {
  const { width, height } = useWindowDimensions();
  const r = Math.max(width, height * 0.5);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no">
      <LinearGradient colors={['#EEF3F8', '#E8F2F1', '#F1EFE8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="gb" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor="#4E6288" stopOpacity="0.5" /><Stop offset="1" stopColor="#4E6288" stopOpacity="0" /></RadialGradient>
          <RadialGradient id="gt" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor="#14B8A6" stopOpacity="0.46" /><Stop offset="1" stopColor="#14B8A6" stopOpacity="0" /></RadialGradient>
          <RadialGradient id="gg" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor="#4ADE80" stopOpacity="0.38" /><Stop offset="1" stopColor="#4ADE80" stopOpacity="0" /></RadialGradient>
          <RadialGradient id="gs" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor="#E8D6B0" stopOpacity="0.65" /><Stop offset="1" stopColor="#E8D6B0" stopOpacity="0" /></RadialGradient>
        </Defs>
        <Circle cx={width * 0.1} cy={height * 0.08} r={r * 0.62} fill="url(#gb)" />
        <Circle cx={width * 0.95} cy={height * 0.3} r={r * 0.6} fill="url(#gt)" />
        <Circle cx={width * 0.75} cy={height * 0.95} r={r * 0.62} fill="url(#gg)" />
        <Circle cx={width * 0.15} cy={height * 0.78} r={r * 0.55} fill="url(#gs)" />
      </Svg>
    </View>
  );
}
