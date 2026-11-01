import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// Expo's push API caps a single request at 100 messages.
const BATCH_SIZE = 100;
/** The Android notification channel the phone app registers with a sound and a heads-up banner. */
export const ANDROID_ALERT_CHANNEL = 'alerts';

interface ExpoPushResult {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Sends real push notifications (a phone alert when the app isn't open),
 * as opposed to NotificationsService's in-app inbox rows — those two were
 * previously the same thing, since nothing ever actually pushed anything.
 * expo-notifications was installed and configured as a build-time config
 * plugin (native icon/channel), but nothing at runtime ever requested
 * permission, registered a device, or called Expo's push API — every
 * "notification" only ever reached whoever happened to open the app and
 * look at the bell icon.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Upsert by token, not by (userId, token) — the same physical device
   *  re-registering (app restart, re-login, a reinstall that happens to
   *  keep the same Expo push token) should re-point at whoever's
   *  currently logged in rather than pile up a duplicate row still
   *  pointed at whoever used this device before. */
  async registerToken(userId: string, token: string, platform?: string) {
    return this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }

  /** Called on logout — a device shouldn't keep receiving push
   *  notifications meant for whoever's no longer signed in on it. */
  async unregisterToken(token: string) {
    await this.prisma.pushToken.deleteMany({ where: { token } });
  }

  /**
   * Best-effort by design — a failed or slow push send must never fail
   * the caller's request (NotificationsService.send already saved the
   * real in-app record regardless; push is a bonus delivery channel on
   * top of that, not the source of truth).
   */
  async sendToUsers(
    userIds: string[],
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    if (userIds.length === 0) return;
    try {
      await this.deliver(userIds, title, body, data);
    } catch (err) {
      this.logger.error(`Push send failed: ${err}`);
    }
  }

  /**
   * A test alert to the caller's own phones, reporting what happened — so "I get no notifications" can be told
   * apart: no phone registered, Expo refusing the message (usually Firebase credentials missing), or delivered.
   */
  async sendTest(userId: string): Promise<{ devices: number; accepted: number; problems: string[] }> {
    try {
      return await this.deliver([userId], 'Test alert', 'If you can hear this, alerts from NG Home are working.', { type: 'TEST' });
    } catch (err) {
      return { devices: 0, accepted: 0, problems: [`The push service could not be reached: ${err}`] };
    }
  }

  private async deliver(
    userIds: string[],
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ): Promise<{ devices: number; accepted: number; problems: string[] }> {
    const tokens = await this.prisma.pushToken.findMany({ where: { userId: { in: userIds } } });
    const outcome = { devices: tokens.length, accepted: 0, problems: [] as string[] };
    if (tokens.length === 0) return outcome;

    const messages = tokens.map((t) => ({
      to: t.token,
      title,
      body,
      data: data ?? {},
      sound: 'default' as const,
      // Delivered at once and shown as a heads-up with a sound, not held back for a sleeping phone. The
      // channel is created by the app (see Mobile/src/notifications/push.ts); one that does not exist yet
      // falls back to Android's default, which still sounds.
      priority: 'high' as const,
      channelId: ANDROID_ALERT_CHANNEL,
    }));

    const staleTokens: string[] = [];

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch),
      });

      if (!res.ok) {
        this.logger.warn(`Expo push send failed: HTTP ${res.status}`);
        outcome.problems.push(`The push service answered HTTP ${res.status}.`);
        continue;
      }

      const json = (await res.json()) as { data?: ExpoPushResult[] };
      (json.data ?? []).forEach((result, idx) => {
        if (result.status === 'ok') {
          outcome.accepted += 1;
          return;
        }
        // Anything other than "accepted" is worth seeing in the server log: a missing Firebase key on the
        // Expo account (InvalidCredentials), a rate limit, a message that is too big. Without this a push
        // that never arrives leaves no trace anywhere.
        const why = `${result.details?.error ?? 'unknown'}${result.message ? ` — ${result.message}` : ''}`;
        this.logger.warn(`Expo push rejected: ${why}`);
        outcome.problems.push(why);
        // DeviceNotRegistered means the app was uninstalled or the token
        // otherwise expired on Expo's side — stop sending to it, it will
        // never succeed again until the device re-registers a new one.
        if (result.details?.error === 'DeviceNotRegistered') staleTokens.push(batch[idx].to);
      });
    }

    if (staleTokens.length > 0) {
      await this.prisma.pushToken.deleteMany({ where: { token: { in: staleTokens } } });
    }
    return outcome;
  }
}
