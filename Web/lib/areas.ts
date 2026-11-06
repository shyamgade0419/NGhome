import {
  BarChart3, BadgePercent, Bell, BookOpen, CalendarCheck, CalendarDays, Car, ClipboardCheck, CreditCard, Droplets, DoorOpen,
  FileText, FolderOpen, HelpCircle, Home, Landmark, LayoutDashboard, LayoutList, Megaphone, Package, PiggyBank, Receipt,
  Settings, ShieldCheck, UserCheck, UserCircle, Users, Wallet, Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Tone } from '@/lib/tones';

/** A part of the app, with the colour and icon it is known by (the same colours as the phone app). */
export interface Area {
  tone: Tone;
  icon: LucideIcon;
}

/**
 * Each part of the app has one colour: billing is blue, payments green, expenses and anything that goes out are coral,
 * waiting things (the helpdesk, parcels) amber, notices violet, and places and bookings teal. The longest matching route
 * decides, so /billing/my is its own and /billing is billing.
 */
const AREAS: ReadonlyArray<readonly [string, Area]> = [
  ['/billing/statement', { tone: 'teal', icon: LayoutList }],
  ['/billing/opening', { tone: 'blue', icon: BookOpen }],
  ['/billing/discounts', { tone: 'blue', icon: BadgePercent }],
  ['/billing/advances', { tone: 'blue', icon: PiggyBank }],
  ['/billing/my', { tone: 'blue', icon: FileText }],
  ['/billing', { tone: 'blue', icon: Receipt }],
  ['/payments', { tone: 'green', icon: CreditCard }],
  ['/expenses', { tone: 'coral', icon: Wallet }],
  ['/salaries', { tone: 'coral', icon: UserCircle }],
  ['/accounts', { tone: 'violet', icon: Landmark }],
  ['/finances', { tone: 'violet', icon: PiggyBank }],
  ['/residents', { tone: 'blue', icon: Users }],
  ['/flats', { tone: 'blue', icon: Home }],
  ['/water', { tone: 'teal', icon: Droplets }],
  ['/reports', { tone: 'green', icon: BarChart3 }],
  ['/community', { tone: 'violet', icon: Megaphone }],
  ['/helpdesk', { tone: 'amber', icon: Wrench }],
  ['/meetings', { tone: 'teal', icon: CalendarDays }],
  ['/documents', { tone: 'blue', icon: FolderOpen }],
  ['/amenities', { tone: 'teal', icon: CalendarCheck }],
  ['/visitors', { tone: 'coral', icon: DoorOpen }],
  ['/parcels', { tone: 'amber', icon: Package }],
  ['/household-help', { tone: 'green', icon: UserCheck }],
  ['/vehicles', { tone: 'blue', icon: Car }],
  ['/staff-attendance', { tone: 'green', icon: ClipboardCheck }],
  ['/audit-logs', { tone: 'violet', icon: ShieldCheck }],
  ['/notifications', { tone: 'coral', icon: Bell }],
  ['/settings', { tone: 'teal', icon: Settings }],
  ['/help', { tone: 'teal', icon: HelpCircle }],
  ['/profile', { tone: 'blue', icon: UserCircle }],
];

const HOME: Area = { tone: 'teal', icon: LayoutDashboard };

/** The area a page belongs to, from its route; null for a route it does not know. */
export function areaForPath(pathname: string | null | undefined): Area | null {
  const path = (pathname ?? '').split('?')[0].replace(/\/+$/, '') || '/';
  if (path === '/') return HOME;
  let best: { len: number; area: Area } | null = null;
  for (const [prefix, area] of AREAS) {
    if ((path === prefix || path.startsWith(prefix + '/')) && (!best || prefix.length > best.len)) best = { len: prefix.length, area };
  }
  return best ? best.area : null;
}
