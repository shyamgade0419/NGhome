import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import type { Tone } from './tones';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** A part of the app, with the colour and icon it is known by wherever it appears. */
export interface Area {
  tone: Tone;
  icon: IconName;
}

/**
 * Each part of the app has one colour: billing is blue, payments green, expenses and anything that goes out are coral,
 * waiting things (the helpdesk, parcels) amber, notices and chat violet, and places and bookings teal. The first rule
 * that matches a screen's title decides, so a screen gets its colour without being edited one by one; more specific words
 * come first ("Payment Approvals" is payments before it is billing).
 */
const RULES: ReadonlyArray<readonly [RegExp, Area | null]> = [
  // The sign-in, join and register screens have no area: they come before anyone is in a part of the app.
  [/create your|join your|forgot|sign in|register|welcome/i, null],
  [/payment/i, { tone: 'green', icon: 'card-outline' }],
  [/expense|salar/i, { tone: 'coral', icon: 'wallet-outline' }],
  [/water/i, { tone: 'teal', icon: 'water-outline' }],
  [/bill|maintenance|invoice|credit|discount|opening/i, { tone: 'blue', icon: 'receipt-outline' }],
  [/helpdesk|request/i, { tone: 'amber', icon: 'construct-outline' }],
  [/announce|community|forum|chat|message|board/i, { tone: 'violet', icon: 'chatbubbles-outline' }],
  [/accounts|funds?|financ/i, { tone: 'violet', icon: 'business-outline' }],
  [/report/i, { tone: 'green', icon: 'bar-chart-outline' }],
  [/meeting|amenit|booking/i, { tone: 'teal', icon: 'calendar-outline' }],
  [/event/i, { tone: 'coral', icon: 'sparkles-outline' }],
  [/visitor|gate|guard/i, { tone: 'coral', icon: 'walk-outline' }],
  [/parcel|deliver/i, { tone: 'amber', icon: 'cube-outline' }],
  [/household|helper/i, { tone: 'green', icon: 'people-circle-outline' }],
  [/vehicle|parking/i, { tone: 'blue', icon: 'car-outline' }],
  [/directory|resident|member|flat|building/i, { tone: 'blue', icon: 'people-outline' }],
  [/document/i, { tone: 'blue', icon: 'folder-open-outline' }],
  [/notification/i, { tone: 'coral', icon: 'notifications-outline' }],
  [/audit/i, { tone: 'violet', icon: 'shield-checkmark-outline' }],
  [/setting|rule|role|permission/i, { tone: 'teal', icon: 'settings-outline' }],
  [/help|guide/i, { tone: 'teal', icon: 'help-circle-outline' }],
  [/profile/i, { tone: 'blue', icon: 'person-outline' }],
];

/** The area a screen belongs to, from its title; null when it matches none (it then gets no coloured chip). */
export function areaForTitle(title: string): Area | null {
  for (const [pattern, area] of RULES) if (pattern.test(title)) return area;
  return null;
}
