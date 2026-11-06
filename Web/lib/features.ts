import {
  Briefcase, Calendar, Car, CalendarCheck, DoorOpen, MessageCircle, MessagesSquare, Package, Sparkles, UserCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Tone } from '@/lib/tones';

/**
 * The parts of the app a society can switch off when it does not use them (a standalone block with no parking, no gate or no
 * clubhouse). The names match the server's (App/src/societies/features.ts) and the phone app's. Every feature is on unless
 * the admin switched it off.
 */
export type FeatureKey = 'visitors' | 'deliveries' | 'householdHelp' | 'parking' | 'amenities' | 'events' | 'meetings' | 'forum' | 'chat' | 'staff';
export type Features = Record<FeatureKey, boolean>;

export interface FeatureInfo {
  key: FeatureKey;
  label: string;
  description: string;
  icon: LucideIcon;
  tone: Tone;
}

export const FEATURES: readonly FeatureInfo[] = [
  { key: 'visitors', label: 'Visitors and gate', description: 'Gate log, visitor approvals and invitations.', icon: DoorOpen, tone: 'coral' },
  { key: 'deliveries', label: 'Parcels and deliveries', description: 'Parcels received at the gate.', icon: Package, tone: 'amber' },
  { key: 'householdHelp', label: 'Household help', description: 'Maids, cooks and drivers who come to flats.', icon: UserCheck, tone: 'green' },
  { key: 'parking', label: 'Vehicles and parking', description: 'Registered vehicles and parking slots.', icon: Car, tone: 'blue' },
  { key: 'amenities', label: 'Amenities and bookings', description: 'Clubhouse, hall and other spaces residents can book.', icon: CalendarCheck, tone: 'teal' },
  { key: 'events', label: 'Events and activities', description: 'Festivals and get-togethers with a budget (in the phone app).', icon: Sparkles, tone: 'coral' },
  { key: 'meetings', label: 'Meetings', description: 'Meeting agendas and minutes.', icon: Calendar, tone: 'teal' },
  { key: 'forum', label: 'Community board', description: 'The board where residents post and reply (in the phone app).', icon: MessagesSquare, tone: 'violet' },
  { key: 'chat', label: 'Messages', description: 'Chat between residents and with the committee (in the phone app).', icon: MessageCircle, tone: 'green' },
  { key: 'staff', label: 'Staff and salaries', description: 'Staff attendance, rosters and salaries.', icon: Briefcase, tone: 'amber' },
];

export const ALL_ON: Features = Object.fromEntries(FEATURES.map((f) => [f.key, true])) as Features;

/** The feature a page belongs to, from its route, or null when it belongs to none (billing, payments, the helpdesk…). */
export function featureForPath(path: string): FeatureKey | null {
  const p = path.split('?')[0];
  if (/^\/visitors/.test(p)) return 'visitors';
  if (/^\/parcels/.test(p)) return 'deliveries';
  if (/^\/household-help/.test(p)) return 'householdHelp';
  if (/^\/vehicles/.test(p)) return 'parking';
  if (/^\/amenities/.test(p)) return 'amenities';
  if (/^\/meetings/.test(p)) return 'meetings';
  if (/^\/(staff-attendance|salaries)/.test(p)) return 'staff';
  return null;
}
