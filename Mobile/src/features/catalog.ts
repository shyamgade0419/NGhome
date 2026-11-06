import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import type { Tone } from '@/theme/tones';

/**
 * The parts of the app a society can switch off when it does not use them (a standalone block with no parking, no gate
 * or no clubhouse). The names match the server's (App/src/societies/features.ts). Every feature is on unless the admin
 * switched it off.
 */
export type FeatureKey = 'visitors' | 'deliveries' | 'householdHelp' | 'parking' | 'amenities' | 'events' | 'meetings' | 'forum' | 'chat' | 'staff';
export type Features = Record<FeatureKey, boolean>;

export interface FeatureInfo {
  key: FeatureKey;
  label: string;
  description: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  tone: Tone;
}

export const FEATURES: readonly FeatureInfo[] = [
  { key: 'visitors', label: 'Visitors and gate', description: 'Gate log, visitor approvals and invitations.', icon: 'walk-outline', tone: 'coral' },
  { key: 'deliveries', label: 'Parcels and deliveries', description: 'Parcels received at the gate.', icon: 'cube-outline', tone: 'amber' },
  { key: 'householdHelp', label: 'Household help', description: 'Maids, cooks and drivers who come to flats.', icon: 'people-circle-outline', tone: 'green' },
  { key: 'parking', label: 'Vehicles and parking', description: 'Registered vehicles and parking slots.', icon: 'car-outline', tone: 'blue' },
  { key: 'amenities', label: 'Amenities and bookings', description: 'Clubhouse, hall and other spaces residents can book.', icon: 'calendar-outline', tone: 'teal' },
  { key: 'events', label: 'Events and activities', description: 'Festivals and get-togethers with a budget.', icon: 'sparkles-outline', tone: 'coral' },
  { key: 'meetings', label: 'Meetings', description: 'Meeting agendas and minutes.', icon: 'people-outline', tone: 'teal' },
  { key: 'forum', label: 'Community board', description: 'The board where residents post and reply.', icon: 'chatbubbles-outline', tone: 'violet' },
  { key: 'chat', label: 'Messages', description: 'Chat between residents and with the committee.', icon: 'chatbox-ellipses-outline', tone: 'green' },
  { key: 'staff', label: 'Staff and salaries', description: 'Staff attendance, rosters and salaries.', icon: 'briefcase-outline', tone: 'amber' },
];

export const ALL_ON: Features = Object.fromEntries(FEATURES.map((f) => [f.key, true])) as Features;

/** The feature a screen belongs to, from its route, or null when it belongs to none (billing, payments, the helpdesk…). */
export function featureForRoute(route: string): FeatureKey | null {
  if (/\/visitors/.test(route)) return 'visitors';
  if (/\/deliveries|\/parcels/.test(route)) return 'deliveries';
  if (/\/household-help/.test(route)) return 'householdHelp';
  if (/\/vehicles|\/parking/.test(route)) return 'parking';
  if (/\/amenities/.test(route)) return 'amenities';
  if (/\/events/.test(route)) return 'events';
  if (/\/meetings/.test(route)) return 'meetings';
  if (/\/forum/.test(route)) return 'forum';
  if (/\/chat/.test(route)) return 'chat';
  if (/\/salaries|\/staff/.test(route)) return 'staff';
  return null;
}
