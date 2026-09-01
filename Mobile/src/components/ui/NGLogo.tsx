import React from 'react';
import Svg, {
  Path, Rect, Polygon, Line, G, Defs,
  LinearGradient, Stop, Circle,
} from 'react-native-svg';

const NAVY = '#0D2147';
const NAVY_DARK = '#071428';
const GREEN = '#3D8C3C';
const WHITE = '#FFFFFF';

interface NGLogoProps {
  /** Rendered height — width is derived from the 200:240 aspect ratio */
  size?: number;
}

/**
 * NG Home shield logo — recreated as a React Native SVG component.
 * Uses react-native-svg (included in Expo SDK 51).
 *
 * Shield:   Dark navy (#0D2147)
 * NG text:  White stroked paths
 * Home:     White house + 2×2 green windows
 * Wrench:   White open-jaw wrench (lower left)
 * Swoosh:   Green (#3D8C3C) arc at shield bottom
 */
export function NGLogo({ size = 100 }: NGLogoProps) {
  const width = size * (200 / 240);
  const height = size;

  return (
    <Svg
      width={width}
      height={height}
      viewBox="0 0 200 240"
    >
      <Defs>
        <LinearGradient id="shieldGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#1a3a6a" stopOpacity={0.5} />
          <Stop offset="100%" stopColor="#050e20" stopOpacity={0.3} />
        </LinearGradient>
      </Defs>

      {/* ─── Shield ──────────────────────────────────────────── */}
      <Path
        d="M100,8 L182,34 L182,128 C182,180 144,212 100,231 C56,212 18,180 18,128 L18,34 Z"
        fill={NAVY}
      />
      {/* Subtle inner edge */}
      <Path
        d="M100,14 L176,38 L176,128 C176,176 140,207 100,225 C60,207 24,176 24,128 L24,38 Z"
        fill="none"
        stroke={WHITE}
        strokeWidth={1}
        strokeOpacity={0.1}
      />

      {/* ─── N letter ────────────────────────────────────────── */}
      {/* Left vertical | diagonal \ | right vertical */}
      <Path
        d="M33,105 L33,52 L67,105 L67,52"
        stroke={WHITE}
        strokeWidth={13}
        fill="none"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />

      {/* ─── G letter ────────────────────────────────────────── */}
      <Path
        d="M128,60 C121,53 112,49 100,49
           C84,49 73,60 73,78
           C73,97 84,108 100,108
           C113,108 122,102 128,94
           L128,79 L103,79"
        stroke={WHITE}
        strokeWidth={12}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* ─── Home icon ───────────────────────────────────────── */}
      {/* Roof triangle */}
      <Polygon points="100,122 128,147 72,147" fill={WHITE} />
      {/* House body */}
      <Rect x={76} y={147} width={48} height={36} fill={WHITE} rx={1} />
      {/* 2×2 green windows */}
      <Rect x={80} y={151} width={16} height={13} fill={GREEN} rx={1.5} />
      <Rect x={100} y={151} width={16} height={13} fill={GREEN} rx={1.5} />
      <Rect x={80} y={166} width={16} height={13} fill={GREEN} rx={1.5} />
      <Rect x={100} y={166} width={16} height={13} fill={GREEN} rx={1.5} />

      {/* ─── Wrench ──────────────────────────────────────────── */}
      {/* Handle */}
      <Line
        x1={88} y1={176} x2={58} y2={200}
        stroke={WHITE} strokeWidth={9} strokeLinecap="round"
      />
      {/* Open-jaw head */}
      <Path
        d="M100,158 C93,150 93,140 99,135
           C105,130 114,131 119,137
           L113,143 C110,140 105,141 103,144
           C101,148 103,153 107,155 Z"
        fill={WHITE}
      />

      {/* ─── Green swoosh arc ─────────────────────────────────── */}
      <Path
        d="M42,198 Q100,222 158,196"
        stroke={GREEN}
        strokeWidth={11}
        fill="none"
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Full splash / icon version — logo on a navy rounded background */
export function NGLogoCard({
  size = 100,
  borderRadius = 22,
}: {
  size?: number;
  borderRadius?: number;
}) {
  const width = size;
  const height = size;
  const innerSize = size * 0.72;
  const innerX = (size - innerSize * (200 / 240)) / 2;
  const innerY = (size - innerSize) / 2;

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Defs>
        <LinearGradient id="cardGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#112A59" />
          <Stop offset="100%" stopColor="#071428" />
        </LinearGradient>
      </Defs>

      {/* Background card */}
      <Rect
        x={0} y={0}
        width={width} height={height}
        rx={borderRadius}
        fill="url(#cardGrad)"
      />

      {/* Centered logo mark */}
      <G transform={`translate(${innerX}, ${innerY})`}>
        <NGLogoInner size={innerSize} />
      </G>
    </Svg>
  );
}

/** Internal helper used by NGLogoCard — same paths but in its own G/transform scope */
function NGLogoInner({ size }: { size: number }) {
  const w = size * (200 / 240);
  const scaleX = w / 200;
  const scaleY = size / 240;

  return (
    <G transform={`scale(${scaleX}, ${scaleY})`}>
      <Path
        d="M100,8 L182,34 L182,128 C182,180 144,212 100,231 C56,212 18,180 18,128 L18,34 Z"
        fill={NAVY}
      />
      <Path
        d="M100,14 L176,38 L176,128 C176,176 140,207 100,225 C60,207 24,176 24,128 L24,38 Z"
        fill="none" stroke={WHITE} strokeWidth={1} strokeOpacity={0.12}
      />
      <Path
        d="M33,105 L33,52 L67,105 L67,52"
        stroke={WHITE} strokeWidth={13} fill="none"
        strokeLinecap="square" strokeLinejoin="miter"
      />
      <Path
        d="M128,60 C121,53 112,49 100,49 C84,49 73,60 73,78 C73,97 84,108 100,108 C113,108 122,102 128,94 L128,79 L103,79"
        stroke={WHITE} strokeWidth={12} fill="none"
        strokeLinecap="round" strokeLinejoin="round"
      />
      <Polygon points="100,122 128,147 72,147" fill={WHITE} />
      <Rect x={76} y={147} width={48} height={36} fill={WHITE} rx={1} />
      <Rect x={80} y={151} width={16} height={13} fill={GREEN} rx={1.5} />
      <Rect x={100} y={151} width={16} height={13} fill={GREEN} rx={1.5} />
      <Rect x={80} y={166} width={16} height={13} fill={GREEN} rx={1.5} />
      <Rect x={100} y={166} width={16} height={13} fill={GREEN} rx={1.5} />
      <Line x1={88} y1={176} x2={58} y2={200} stroke={WHITE} strokeWidth={9} strokeLinecap="round" />
      <Path
        d="M100,158 C93,150 93,140 99,135 C105,130 114,131 119,137 L113,143 C110,140 105,141 103,144 C101,148 103,153 107,155 Z"
        fill={WHITE}
      />
      <Path
        d="M42,198 Q100,222 158,196"
        stroke={GREEN} strokeWidth={11} fill="none" strokeLinecap="round"
      />
    </G>
  );
}
