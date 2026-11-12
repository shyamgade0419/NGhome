import {
  announcementNotice,
  eventCancelled,
  eventNotice,
  eventRescheduled,
  eventReminder,
  meetingNotice,
  meetingReminder,
  shorten,
  whenText,
} from './notification-content';

// 14 Nov 2026, 6:30 pm in India is 13:00 UTC.
const SAT = new Date('2026-11-14T13:00:00Z');

describe('notification wording', () => {
  describe('whenText', () => {
    it('writes the day and time in Indian time, wherever the server is', () => {
      expect(whenText(SAT)).toBe('Sat, 14 Nov, 6:30 pm');
      expect(whenText(new Date('2026-11-14T18:35:00Z'))).toBe('Sun, 15 Nov, 12:05 am'); // past midnight in India
    });
  });

  describe('shorten', () => {
    it('leaves short text alone and collapses blank space', () => {
      expect(shorten('  Water   off\n on Saturday ')).toBe('Water off on Saturday');
    });
    it('cuts long text on a word with an ellipsis, within the limit', () => {
      const out = shorten('The water tank on the terrace will be cleaned this Saturday so the supply stays off between ten and two, please store water', 60);
      expect(out.endsWith('…')).toBe(true);
      expect(out.length).toBeLessThanOrEqual(60);
      expect(out).not.toMatch(/\s…$/);
      expect(out.endsWith('st…')).toBe(false); // not mid-word when a space is near
    });
    it('cuts a single long word rather than returning nothing', () => {
      expect(shorten('x'.repeat(300), 20)).toHaveLength(20);
    });
  });

  describe('announcementNotice', () => {
    it('marks urgent and important ones in the title, not normal ones', () => {
      const base = { id: 'a1', title: 'Lift 2 under maintenance', content: 'Use Lift 1.' };
      expect(announcementNotice({ ...base, priority: 'URGENT' }).title).toBe('Urgent: Lift 2 under maintenance');
      expect(announcementNotice({ ...base, priority: 'HIGH' }).title).toBe('Important: Lift 2 under maintenance');
      expect(announcementNotice({ ...base, priority: 'NORMAL' }).title).toBe('Lift 2 under maintenance');
      expect(announcementNotice({ ...base, priority: 'LOW' }).title).toBe('Lift 2 under maintenance');
    });
    it('carries the announcement id so it is never sent twice, and its type', () => {
      const n = announcementNotice({ id: 'a1', title: 't', content: 'c', priority: 'NORMAL' });
      expect(n).toMatchObject({ type: 'ANNOUNCEMENT', data: { announcementId: 'a1' }, body: 'c' });
    });
  });

  describe('meetings', () => {
    it('says when and where, and what it is about', () => {
      const n = meetingNotice({ id: 'm1', title: 'AGM', meetingDate: SAT, location: 'Clubhouse', agenda: 'Budget and repairs' });
      expect(n.title).toBe('Meeting: AGM');
      expect(n.body).toBe('Sat, 14 Nov, 6:30 pm · Clubhouse · Budget and repairs');
      expect(n).toMatchObject({ type: 'MEETING', data: { meetingId: 'm1' } });
    });
    it('leaves out a place or agenda that was not given', () => {
      expect(meetingNotice({ id: 'm1', title: 'AGM', meetingDate: SAT }).body).toBe('Sat, 14 Nov, 6:30 pm');
      expect(meetingNotice({ id: 'm1', title: 'AGM', meetingDate: SAT, location: '  ', agenda: '' }).body).toBe('Sat, 14 Nov, 6:30 pm');
    });
    it('reminds the day before, with its own type', () => {
      const n = meetingReminder({ id: 'm1', title: 'AGM', meetingDate: SAT, location: 'Clubhouse' });
      expect(n).toMatchObject({ title: 'Tomorrow: AGM', type: 'MEETING_REMINDER', data: { meetingId: 'm1' }, body: 'Sat, 14 Nov, 6:30 pm · Clubhouse' });
    });
  });

  describe('events', () => {
    const e = { id: 'e1', title: 'Diwali get-together', eventDate: SAT };
    it('announces, reminds, moves and cancels with distinct types and the event id', () => {
      expect(eventNotice({ ...e, description: 'Snacks and music' })).toMatchObject({ title: 'New event: Diwali get-together', type: 'EVENT', body: 'Sat, 14 Nov, 6:30 pm · Snacks and music', data: { eventId: 'e1' } });
      expect(eventReminder(e)).toMatchObject({ title: 'Tomorrow: Diwali get-together', type: 'EVENT_REMINDER', body: 'Sat, 14 Nov, 6:30 pm' });
      expect(eventRescheduled(e)).toMatchObject({ title: 'Event moved: Diwali get-together', type: 'EVENT_CHANGED', body: 'Now Sat, 14 Nov, 6:30 pm' });
      expect(eventCancelled(e)).toMatchObject({ title: 'Event cancelled: Diwali get-together', type: 'EVENT_CANCELLED', body: 'It was planned for Sat, 14 Nov, 6:30 pm' });
    });
  });
});
