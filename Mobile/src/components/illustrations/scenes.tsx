import React from 'react';
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { Tone, tint, tones } from '@/theme/tones';

/**
 * The drawn pictures of the app: three scenes for the welcome slides and a soft backdrop for empty screens. Flat shapes in
 * the six accent colours, drawn in a 320 by 240 box that scales to the width it is given. They carry no text a person has to
 * read, so they are hidden from screen readers; the slide's own words say the same thing.
 */
interface SceneProps {
  width?: number;
}

const frame = (width: number) => ({ width, height: (width * 240) / 320, viewBox: '0 0 320 240' });
const WHITE = '#FFFFFF';
const INK = '#26231F';

const Sparkle = ({ x, y, size = 7, color }: { x: number; y: number; size?: number; color: string }) => (
  <Path d={`M${x} ${y - size} L${x + size * 0.28} ${y - size * 0.28} L${x + size} ${y} L${x + size * 0.28} ${y + size * 0.28} L${x} ${y + size} L${x - size * 0.28} ${y + size * 0.28} L${x - size} ${y} L${x - size * 0.28} ${y - size * 0.28} Z`} fill={color} />
);

/** Paying maintenance from a phone: a phone with a rupee, a check, coins and a receipt. */
export function PayScene({ width = 300 }: SceneProps) {
  const blue = tones.blue;
  const green = tones.green;
  const amber = tones.amber;
  return (
    <Svg {...frame(width)} accessible={false} importantForAccessibility="no-hide-descendants">
      <Path d="M52 126 C42 64 112 22 186 30 C258 38 292 92 276 152 C262 206 198 228 138 216 C78 206 60 172 52 126Z" fill={tint(blue, 0.86)} />
      <Circle cx={58} cy={176} r={20} fill={amber} />
      <Circle cx={58} cy={176} r={13} fill="none" stroke={tint(amber, 0.55)} strokeWidth={3} />
      <Circle cx={86} cy={198} r={15} fill={tones.coral} />
      <Circle cx={86} cy={198} r={9} fill="none" stroke={tint(tones.coral, 0.55)} strokeWidth={3} />
      <Rect x={110} y={40} width={110} height={172} rx={20} fill={tint(blue, 0.6)} />
      <Rect x={104} y={34} width={110} height={172} rx={20} fill={WHITE} stroke={tint(blue, 0.45)} strokeWidth={2} />
      <Rect x={104} y={34} width={110} height={42} rx={20} fill={blue} />
      <Rect x={104} y={56} width={110} height={20} fill={blue} />
      <Rect x={140} y={44} width={38} height={6} rx={3} fill={tint(blue, 0.55)} />
      <Circle cx={159} cy={118} r={28} fill={green} />
      <SvgText x={159} y={130} fontSize={34} fontWeight="bold" fill={WHITE} textAnchor="middle">₹</SvgText>
      <Rect x={124} y={158} width={70} height={7} rx={3.5} fill={tint(INK, 0.85)} />
      <Rect x={134} y={171} width={50} height={7} rx={3.5} fill={tint(INK, 0.9)} />
      <Rect x={128} y={185} width={62} height={14} rx={7} fill={blue} />
      <Circle cx={212} cy={72} r={17} fill={green} stroke={WHITE} strokeWidth={4} />
      <Path d="M204 72 L210 78 L221 66" fill="none" stroke={WHITE} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      <G>
        <Rect x={226} y={142} width={62} height={46} rx={9} fill={WHITE} stroke={tint(blue, 0.5)} strokeWidth={2} />
        <Rect x={235} y={152} width={30} height={5} rx={2.5} fill={tint(INK, 0.8)} />
        <Rect x={235} y={163} width={44} height={5} rx={2.5} fill={tint(INK, 0.88)} />
        <Rect x={235} y={174} width={20} height={5} rx={2.5} fill={green} />
      </G>
      <Sparkle x={250} y={52} color={tones.violet} />
      <Sparkle x={86} y={70} size={6} color={amber} />
    </Svg>
  );
}

/** Staying in the loop: a megaphone with sound arcs, a calendar card and a bell. */
export function NoticeScene({ width = 300 }: SceneProps) {
  const violet = tones.violet;
  const teal = tones.teal;
  return (
    <Svg {...frame(width)} accessible={false} importantForAccessibility="no-hide-descendants">
      <Path d="M48 120 C40 60 108 20 180 28 C254 36 292 88 278 148 C266 204 200 228 138 218 C78 208 56 172 48 120Z" fill={tint(violet, 0.86)} />
      <Path d="M76 112 L142 76 L142 164 L76 138 Z" fill={violet} />
      <Rect x={60} y={108} width={24} height={34} rx={7} fill={tint(violet, 0.35)} />
      <Rect x={150} y={72} width={14} height={96} rx={7} fill={tint(violet, 0.25)} />
      <Rect x={92} y={150} width={22} height={34} rx={8} fill={tint(violet, 0.35)} />
      <Path d="M176 100 Q192 120 176 142" fill="none" stroke={violet} strokeWidth={5} strokeLinecap="round" />
      <Path d="M190 86 Q216 120 190 156" fill="none" stroke={tint(violet, 0.35)} strokeWidth={5} strokeLinecap="round" />
      <Rect x={200} y={118} width={92} height={96} rx={16} fill={tint(teal, 0.5)} />
      <Rect x={194} y={112} width={92} height={96} rx={16} fill={WHITE} stroke={tint(teal, 0.45)} strokeWidth={2} />
      <Rect x={194} y={112} width={92} height={28} rx={16} fill={teal} />
      <Rect x={194} y={128} width={92} height={12} fill={teal} />
      <Rect x={212} y={102} width={8} height={20} rx={4} fill={tint(teal, 0.2)} />
      <Rect x={260} y={102} width={8} height={20} rx={4} fill={tint(teal, 0.2)} />
      {[0, 1, 2, 3].map((c) => [0, 1, 2].map((r) => (
        <Circle key={`${c}-${r}`} cx={209 + c * 20} cy={156 + r * 17} r={4.5} fill={c === 2 && r === 1 ? tones.coral : tint(INK, 0.85)} />
      )))}
      <Path d="M238 40 C238 30 252 30 252 40 L252 52 L258 60 L232 60 L238 52Z" fill={tones.amber} />
      <Circle cx={245} cy={64} r={4} fill={tones.amber} />
      <Sparkle x={72} y={54} color={teal} />
      <Sparkle x={282} y={92} size={6} color={tones.coral} />
    </Svg>
  );
}

/** The gate handled: a gatehouse arch, a visitor, a parcel and an approved badge. */
export function GateScene({ width = 300 }: SceneProps) {
  const coral = tones.coral;
  const teal = tones.teal;
  const amber = tones.amber;
  return (
    <Svg {...frame(width)} accessible={false} importantForAccessibility="no-hide-descendants">
      <Path d="M50 122 C42 62 110 22 184 30 C256 38 292 90 276 150 C262 206 198 228 138 216 C78 206 58 172 50 122Z" fill={tint(coral, 0.86)} />
      <Rect x={62} y={94} width={128} height={116} rx={6} fill={WHITE} stroke={tint(coral, 0.45)} strokeWidth={2} />
      <Path d="M56 96 Q126 26 196 96 Z" fill={coral} />
      <Path d="M82 210 L82 134 Q126 98 170 134 L170 210 Z" fill={tint(coral, 0.8)} />
      <Rect x={118} y={136} width={16} height={74} fill={tint(coral, 0.55)} />
      <Circle cx={126} cy={74} r={9} fill={WHITE} />
      <Rect x={70} y={96} width={112} height={7} fill={tint(coral, 0.3)} />
      <Circle cx={236} cy={112} r={15} fill="#F2C9A5" />
      <Path d="M221 106 Q236 90 251 106 L251 110 L221 110 Z" fill={INK} />
      <Rect x={218} y={128} width={36} height={52} rx={14} fill={teal} />
      <Rect x={222} y={178} width={12} height={30} rx={5} fill={INK} />
      <Rect x={240} y={178} width={12} height={30} rx={5} fill={INK} />
      <Rect x={196} y={166} width={46} height={40} rx={6} fill={amber} />
      <Rect x={214} y={166} width={10} height={40} fill={tint(amber, 0.55)} />
      <Rect x={196} y={178} width={46} height={7} fill={tint(amber, 0.35)} />
      <Circle cx={262} cy={78} r={17} fill={tones.green} stroke={WHITE} strokeWidth={4} />
      <Path d="M254 78 L260 84 L271 72" fill="none" stroke={WHITE} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      <Sparkle x={58} y={60} color={amber} />
      <Sparkle x={284} y={150} size={6} color={tones.violet} />
    </Svg>
  );
}

/**
 * The soft shape behind the icon of an empty screen: a blob in the tone's colour with a few floating dots and sparkles.
 * The icon itself is drawn on top by the caller, centred.
 */
export function EmptyBackdrop({ tone = 'teal', size = 132 }: { tone?: Tone; size?: number }) {
  const color = tones[tone];
  return (
    <Svg width={size} height={size} viewBox="0 0 132 132" accessible={false} importantForAccessibility="no-hide-descendants">
      <Path d="M22 62 C16 28 50 8 82 14 C114 20 128 48 120 78 C112 108 82 124 52 118 C30 112 26 88 22 62Z" fill={tint(color, 0.84)} />
      <Circle cx={18} cy={98} r={6} fill={tint(color, 0.55)} />
      <Circle cx={116} cy={22} r={5} fill={tint(color, 0.45)} />
      <Circle cx={106} cy={112} r={4} fill={tint(tones.amber, 0.45)} />
      <Sparkle x={24} y={28} size={7} color={tint(color, 0.3)} />
      <Sparkle x={112} y={70} size={6} color={tint(tones.violet, 0.4)} />
    </Svg>
  );
}
