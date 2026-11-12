/**
 * Who a notification is sent to, as chosen on the compose screen: everyone, the committee, the staff, some buildings, or
 * some flats. Kept apart from the screen so the rules can be tested on their own.
 */

export type AudienceKind = 'ALL_RESIDENTS' | 'COMMITTEE' | 'STAFF' | 'BUILDING' | 'SPECIFIC_FLATS';

export interface AudienceChoice {
  kind: AudienceKind;
  buildingIds: string[];
  flatIds: string[];
}

export const EVERYONE: AudienceChoice = { kind: 'ALL_RESIDENTS', buildingIds: [], flatIds: [] };

export const AUDIENCE_OPTIONS: { kind: AudienceKind; label: string }[] = [
  { kind: 'ALL_RESIDENTS', label: 'Everyone' },
  { kind: 'BUILDING', label: 'Buildings' },
  { kind: 'SPECIFIC_FLATS', label: 'Flats' },
  { kind: 'COMMITTEE', label: 'Committee' },
  { kind: 'STAFF', label: 'Staff' },
];

/** Switching to another kind keeps what was picked for it, and drops nothing the person might switch back to. */
export const withKind = (choice: AudienceChoice, kind: AudienceKind): AudienceChoice => ({ ...choice, kind });

/** The id added if it is not there, removed if it is. */
export const toggleId = (ids: string[], id: string): string[] => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

/** Every id in `ids` is selected: used for a 'select all in this building' control. */
export const allSelected = (selected: string[], ids: string[]): boolean => ids.length > 0 && ids.every((id) => selected.includes(id));

/** Adds all of `ids`, or, when they are all selected already, removes them all. */
export function toggleAll(selected: string[], ids: string[]): string[] {
  return allSelected(selected, ids) ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])];
}

/** Why the choice cannot be sent yet, or null. */
export function choiceProblem(choice: AudienceChoice): string | null {
  if (choice.kind === 'BUILDING' && choice.buildingIds.length === 0) return 'Choose at least one building.';
  if (choice.kind === 'SPECIFIC_FLATS' && choice.flatIds.length === 0) return 'Choose at least one flat.';
  return null;
}

/** The fields to send with the notification: nothing extra for everyone, the committee or the staff. */
export function toPayload(choice: AudienceChoice): { audience: AudienceKind; audienceConfig?: { buildingIds?: string[]; flatIds?: string[] } } {
  if (choice.kind === 'BUILDING') return { audience: 'BUILDING', audienceConfig: { buildingIds: choice.buildingIds } };
  if (choice.kind === 'SPECIFIC_FLATS') return { audience: 'SPECIFIC_FLATS', audienceConfig: { flatIds: choice.flatIds } };
  return { audience: choice.kind };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The send button: 'Send to All Members', 'Send to the committee', 'Send to 2 buildings'. */
export function sendLabel(choice: AudienceChoice): string {
  switch (choice.kind) {
    case 'COMMITTEE': return 'Send to the committee';
    case 'STAFF': return 'Send to the staff';
    case 'BUILDING': return choice.buildingIds.length ? `Send to ${plural(choice.buildingIds.length, 'building', 'buildings')}` : 'Send to buildings';
    case 'SPECIFIC_FLATS': return choice.flatIds.length ? `Send to ${plural(choice.flatIds.length, 'flat', 'flats')}` : 'Send to flats';
    default: return 'Send to All Members';
  }
}

/** What to tell the sender once it has gone: how many people it reached. */
export function sentMessage(recipientCount: number | undefined): { title: string; message: string } {
  if (recipientCount === 0) return { title: 'Nobody to send to', message: 'No one lives in the buildings or flats you chose yet, so nobody was notified.' };
  if (recipientCount === undefined) return { title: 'Sent', message: 'Notification sent.' };
  return { title: 'Sent', message: `Notification sent to ${plural(recipientCount, 'person', 'people')}.` };
}
