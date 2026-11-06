/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 3 of the look, the pieces every screen shares: the colour of each part of the app, the header's chip, status
 * badges, list chips, the summary strip, the coloured tab icon and the button's press.
 */

import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: (p: any) => { const { Text: T } = jest.requireActual('react-native'); return <T>{`icon:${p.name}`}</T>; } }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));

import { areaForTitle } from '@/theme/areas';
import { tones, tint } from '@/theme/tones';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { StatusBadge, paymentStatusVariant } from '@/components/ui/StatusBadge';
import { IconChip } from '@/components/ui/IconChip';
import { SummaryStrip } from '@/components/home/SummaryStrip';
import { TabIcon } from '@/components/nav/TabIcon';
import { Button } from '@/components/ui/Button';

const textOf = (node: any): string =>
  node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => n.children.join('')).join(' | ');
const trees: any[] = [];
async function render(el: React.ReactElement) {
  let tree!: any;
  await act(async () => { tree = TestRenderer.create(el); });
  trees.push(tree);
  return tree;
}
afterEach(async () => { await act(async () => { trees.splice(0).forEach((t) => t.unmount()); }); });
const flat = (style: any): Record<string, any> => (Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : (style ?? {}));

describe('the colour of each part of the app', () => {
  it.each([
    ['Payment Approvals', 'green'],
    ['Payments', 'green'],
    ['Billing & Maintenance', 'blue'],
    ['Advance Credit', 'blue'],
    ['Expenses', 'coral'],
    ['Salaries', 'coral'],
    ['Helpdesk', 'amber'],
    ['Announcements', 'violet'],
    ['Community Board', 'violet'],
    ['Water Billing', 'teal'],
    ['Accounts & Funds', 'violet'],
    ['Reports', 'green'],
    ['Meetings', 'teal'],
    ['Visitors', 'coral'],
    ['Deliveries', 'amber'],
    ['Vehicles & Parking', 'blue'],
    ['Directory', 'blue'],
  ])('puts "%s" in %s', (title, tone) => {
    expect(areaForTitle(title)?.tone).toBe(tone);
  });

  it('gives a payment screen the payments colour even though its title says "approvals", and billing its own', () => {
    expect(areaForTitle('Payment Approvals')?.icon).toBe('card-outline');
    expect(areaForTitle('Billing & Maintenance')?.icon).toBe('receipt-outline');
  });

  it('has no colour for a title it does not know', () => {
    expect(areaForTitle('Something else entirely')).toBeNull();
  });

  it('keeps the sign-in, join and register screens out of every area, even when their words match one', () => {
    for (const t of ['Create your resident account', 'Join Your Society', 'Forgot Password', 'Register Society']) expect(areaForTitle(t)).toBeNull();
  });

  it('colours water before billing, and finances and roles by what they are', () => {
    expect(areaForTitle('Water Billing Model')?.tone).toBe('teal');
    expect(areaForTitle('Society Finances')?.tone).toBe('violet');
    expect(areaForTitle('Roles & Permissions')?.icon).toBe('settings-outline');
  });
});

describe('the screen header', () => {
  it('shows the chip of its area beside the title', async () => {
    const t = await render(<ScreenHeader title="Payment Approvals" />);
    expect(textOf(t.root)).toContain('icon:card-outline');
    expect(textOf(t.root)).toContain('Payment Approvals');
  });

  it('takes an area given to it, or none', async () => {
    const own = await render(<ScreenHeader title="Anything" area={{ tone: 'coral', icon: 'flame-outline' as any }} />);
    expect(textOf(own.root)).toContain('icon:flame-outline');
    const none = await render(<ScreenHeader title="Payment Approvals" area={null} />);
    expect(textOf(none.root)).not.toContain('icon:');
    const unknown = await render(<ScreenHeader title="Something else entirely" />);
    expect(textOf(unknown.root)).not.toContain('icon:');
  });

  it('still has its back arrow and right action', async () => {
    const t = await render(<ScreenHeader title="Expenses" showBack rightAction={<Text>ADD</Text>} />);
    expect(textOf(t.root)).toContain('icon:chevron-back');
    expect(textOf(t.root)).toContain('ADD');
  });
});

describe('status badges', () => {
  it('keep their text, and carry a dot in the colour of the status', async () => {
    const t = await render(<StatusBadge label="APPROVED" variant={paymentStatusVariant('APPROVED')} />);
    expect(textOf(t.root)).toBe('APPROVED');
    const dot = t.root.findAll((n: any) => n.type === 'View' && flat(n.props.style).width === 6 && flat(n.props.style).height === 6)[0];
    expect(flat(dot.props.style).backgroundColor).toBe(tones.green);
    const pending = await render(<StatusBadge label="PENDING" variant={paymentStatusVariant('PENDING')} />);
    const d2 = pending.root.findAll((n: any) => n.type === 'View' && flat(n.props.style).width === 6)[0];
    expect(flat(d2.props.style).backgroundColor).toBe(tones.amber);
  });
});

describe('list chips', () => {
  it('shows an icon, or up to two letters in capitals', async () => {
    expect(textOf((await render(<IconChip tone="blue" icon="receipt-outline" />)).root)).toBe('icon:receipt-outline');
    expect(textOf((await render(<IconChip tone="green" text="a-104" />)).root)).toBe('A-');
    expect(textOf((await render(<IconChip tone="green" />)).root)).toBe('');
  });

  it('sits on the soft colour of its tone', async () => {
    const t = await render(<IconChip tone="coral" icon="wallet-outline" size={40} />);
    const box = t.root.findAll((n: any) => n.type === 'View')[0];
    expect(flat(box.props.style).backgroundColor).toBe(tint(tones.coral, 0.84));
  });
});

describe('the summary strip', () => {
  it('shows its tiles, and a tile with an action is a button', async () => {
    const press = jest.fn();
    const t = await render(
      <SummaryStrip tiles={[
        { key: 'a', tone: 'amber', icon: 'time-outline', label: 'To review', value: '3', onPress: press },
        { key: 'b', tone: 'green', icon: 'checkmark-circle-outline', label: 'Approved', value: '12' },
      ]} />,
    );
    const text = textOf(t.root);
    for (const x of ['To review', '3', 'Approved', '12']) expect(text).toContain(x);
    const buttons = t.root.findAllByType(TouchableOpacity);
    expect(buttons).toHaveLength(1);
    await act(async () => { buttons[0].props.onPress(); });
    expect(press).toHaveBeenCalled();
  });

  it('draws nothing for no tiles', async () => {
    expect((await render(<SummaryStrip tiles={[]} />)).toJSON()).toBeNull();
  });
});

describe('the tab icon', () => {
  it('colours the tab you are on and leaves the others grey', async () => {
    const on = await render(<TabIcon name="card" tone="green" focused color="#999999" />);
    const off = await render(<TabIcon name="card-outline" tone="green" focused={false} color="#999999" />);
    const bg = (t: any) => flat(t.root.findAll((n: any) => n.type === 'View')[0].props.style).backgroundColor;
    expect(bg(on)).toBe(tint(tones.green, 0.84));
    expect(bg(off)).toBeUndefined();
  });
});

describe('the button', () => {
  it('still works as before: label, press, disabled and loading', async () => {
    const onPress = jest.fn();
    const t = await render(<Button label="Save" onPress={onPress} />);
    expect(textOf(t.root)).toBe('Save');
    await act(async () => { t.root.findAllByType(TouchableOpacity)[0].props.onPress(); });
    expect(onPress).toHaveBeenCalledTimes(1);
    const off = await render(<Button label="Nope" onPress={onPress} disabled />);
    expect(off.root.findAllByType(TouchableOpacity)[0].props.disabled).toBe(true);
    await act(async () => { t.root.findAllByType(TouchableOpacity)[0].props.onPressIn(); t.root.findAllByType(TouchableOpacity)[0].props.onPressOut(); });
  });
});
