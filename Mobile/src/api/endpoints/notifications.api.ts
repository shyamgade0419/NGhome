import apiClient from '@/api/client';
import { PaginatedResponse, PaginationQuery } from '@/api/types';

export interface Notification {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  sentByName?: string | null;
}

/**
 * Raw shape of GET /notifications/my — a NotificationRecord row (the
 * per-user delivery record) with its parent Notification included. None of
 * this app's flat Notification fields (title, message, isRead) exist at the
 * top level: title/body live under `.notification`, and read state is the
 * `status` enum (PENDING/SENT/FAILED/READ) or a set `readAt`, not a boolean.
 *
 * The service returns `{ data, total }`, not `{ data, meta }` — and that's
 * exactly why this was still crashing after the previous fix. The global
 * TransformInterceptor only unwraps a service's return value in place when
 * it sees BOTH `data` and `meta` keys; `{ data, total }` doesn't match, so
 * it falls through to its default behavior and wraps the *entire*
 * `{ data, total }` object as `data` again. The real response body is
 * therefore `{ success, data: { data: [...], total } }` — one level
 * deeper than every other list endpoint. Unwrapping only once here (as the
 * previous version did) leaves `rows` as that inner `{ data, total }`
 * object rather than the array, and `rows.map(...)` throws — which is
 * exactly what "Couldn't load notifications" was.
 */
interface NotificationRecordRow {
  id: string;
  createdAt: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'READ';
  readAt: string | null;
  notification: { id: string; title: string; body: string; type: string } | null;
}

function toNotification(row: NotificationRecordRow): Notification {
  return {
    id: row.id,
    title: row.notification?.title ?? 'Notification',
    message: row.notification?.body ?? '',
    isRead: row.status === 'READ' || row.readAt != null,
    createdAt: row.createdAt,
    sentByName: null,
  };
}

export const notificationsApi = {
  /** Resident: get my notifications (paginated). */
  getMine: async (query?: PaginationQuery): Promise<PaginatedResponse<Notification>> => {
    const { data } = await apiClient.get<{ data: { data: NotificationRecordRow[]; total: number } }>(
      '/notifications/my',
      { params: query },
    );
    const rows = data?.data?.data ?? [];
    const total = data?.data?.total ?? rows.length;
    const limit = query?.limit ?? rows.length ?? 1;
    return {
      success: true,
      data: rows.map(toNotification),
      meta: {
        total,
        page: query?.page ?? 1,
        limit,
        totalPages: limit > 0 ? Math.ceil(total / limit) : 1,
      },
    };
  },

  /** Mark a single notification as read. */
  markRead: async (id: string): Promise<void> => {
    await apiClient.patch(`/notifications/my/${id}/read`, {});
  },

  /** Powers the bell-icon badge — previously nothing indicated unread
   *  notifications existed without opening the list. */
  getUnreadCount: async (): Promise<number> => {
    const { data } = await apiClient.get<{ data: { count: number } }>('/notifications/my/unread-count');
    return data?.data?.count ?? 0;
  },

  /**
   * Admin: send a notification to society members.
   * type/audience/channels are unused today but required (or defaulted
   * server-side) by SendNotificationDto — send them explicitly rather than
   * relying on defaults that could change.
   */
  send: async (payload: { title: string; body: string; type?: string }): Promise<void> => {
    await apiClient.post('/notifications', { type: 'GENERAL', ...payload });
  },
};
