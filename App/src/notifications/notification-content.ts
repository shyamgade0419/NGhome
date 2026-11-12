/**
 * The words of the notifications the app sends by itself when something is announced, scheduled or changed. Kept as plain
 * functions so the wording can be read and tested in one place. Dates are shown in Indian time.
 */

const TIME_ZONE = 'Asia/Kolkata';

export interface Notice {
  title: string;
  body: string;
  type: string;
  data: Record<string, unknown>;
}

/** 'Sat 14 Nov, 6:00 pm' */
export function whenText(date: Date): string {
  const day = date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TIME_ZONE });
  const time = date
    .toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TIME_ZONE })
    .replace(/\s?(am|pm)/i, (_m, ap: string) => ` ${ap.toLowerCase()}`);
  return `${day}, ${time}`;
}

/** The text cut to `max` characters on a word, with an ellipsis, so a long message does not overflow a notification. */
export function shorten(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const join = (...parts: Array<string | null | undefined>) => parts.filter((p): p is string => !!p && p.trim().length > 0).join(' · ');

export function announcementNotice(a: { id: string; title: string; content: string; priority: string }): Notice {
  const prefix = a.priority === 'URGENT' ? 'Urgent: ' : a.priority === 'HIGH' ? 'Important: ' : '';
  return { title: `${prefix}${a.title}`, body: shorten(a.content), type: 'ANNOUNCEMENT', data: { announcementId: a.id, priority: a.priority } };
}

export function meetingNotice(m: { id: string; title: string; meetingDate: Date; location?: string | null; agenda?: string | null }): Notice {
  return {
    title: `Meeting: ${m.title}`,
    body: join(whenText(m.meetingDate), m.location, m.agenda ? shorten(m.agenda, 90) : null),
    type: 'MEETING',
    data: { meetingId: m.id },
  };
}

export function meetingReminder(m: { id: string; title: string; meetingDate: Date; location?: string | null }): Notice {
  return {
    title: `Tomorrow: ${m.title}`,
    body: join(whenText(m.meetingDate), m.location),
    type: 'MEETING_REMINDER',
    data: { meetingId: m.id },
  };
}

export function eventNotice(e: { id: string; title: string; eventDate: Date; description?: string | null }): Notice {
  return {
    title: `New event: ${e.title}`,
    body: join(whenText(e.eventDate), e.description ? shorten(e.description, 90) : null),
    type: 'EVENT',
    data: { eventId: e.id },
  };
}

export function eventReminder(e: { id: string; title: string; eventDate: Date }): Notice {
  return { title: `Tomorrow: ${e.title}`, body: whenText(e.eventDate), type: 'EVENT_REMINDER', data: { eventId: e.id } };
}

export function eventRescheduled(e: { id: string; title: string; eventDate: Date }): Notice {
  return { title: `Event moved: ${e.title}`, body: `Now ${whenText(e.eventDate)}`, type: 'EVENT_CHANGED', data: { eventId: e.id } };
}

export function eventCancelled(e: { id: string; title: string; eventDate: Date }): Notice {
  return { title: `Event cancelled: ${e.title}`, body: `It was planned for ${whenText(e.eventDate)}`, type: 'EVENT_CANCELLED', data: { eventId: e.id } };
}
