/**
 * Who a notification is sent to, as chosen on the compose form: everyone, the committee, the staff, some buildings, or some
 * flats. The same rules as the phone app's compose screen (Mobile/src/notifications/audienceChoice.ts).
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

export const toggleId = (ids: string[], id: string): string[] => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

export const allSelected = (selected: string[], ids: string[]): boolean => ids.length > 0 && ids.every((id) => selected.includes(id));

/** Adds all of `ids`, or, when they are all selected already, removes them all. */
export const toggleAll = (selected: string[], ids: string[]): string[] =>
  allSelected(selected, ids) ? selected.filter((id) => !ids.includes(id)) : Array.from(new Set(selected.concat(ids)));

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
export function sentMessage(recipientCount: number | undefined): { ok: boolean; message: string } {
  if (recipientCount === 0) return { ok: false, message: 'No one lives in the buildings or flats you chose yet, so nobody was notified.' };
  if (recipientCount === undefined) return { ok: true, message: 'Notification sent' };
  return { ok: true, message: `Notification sent to ${plural(recipientCount, 'person', 'people')}` };
}
