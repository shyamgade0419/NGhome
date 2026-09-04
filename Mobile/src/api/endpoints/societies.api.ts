import apiClient from '@/api/client';
import { ApiResponse, PaginatedResponse, PaginationQuery } from '@/api/types';
import { Society, Building, Flat, Announcement, Meeting } from '@/types/society.types';

export const societiesApi = {
  getMySociety: async () => {
    const { data } = await apiClient.get<ApiResponse<Society>>('/societies/my');
    return data.data;
  },

  getMySocietyStats: async () => {
    const { data } = await apiClient.get<ApiResponse<{
      buildings: number;
      flats: number;
      members: number;
      currentPeriod: { id: string; periodYear: number; periodMonth: number; status: string } | null;
    }>>('/societies/my/stats');
    return data.data;
  },

  /**
   * BuildingsService.findAll returns a bare array (prisma.building.findMany()
   * directly), not the {data, meta} wrapper every other paginated list here
   * returns. Web already works around this with
   * `Array.isArray(x) ? x : (x?.data ?? [])`; mirror it rather than assume
   * the wrapper exists.
   */
  getBuildings: async (query?: PaginationQuery) => {
    const { data } = await apiClient.get<Building[] | PaginatedResponse<Building>>('/buildings', {
      params: query,
    });
    const buildings = Array.isArray(data) ? data : ((data as any)?.data ?? []);
    return {
      success: true as const,
      data: buildings,
      meta: { total: buildings.length, page: 1, limit: buildings.length, totalPages: 1 },
    };
  },

  createBuilding: async (payload: {
    name: string;
    code?: string;
    description?: string;
    totalFloors?: number;
  }) => {
    const { data } = await apiClient.post<ApiResponse<Building>>('/buildings', payload);
    return data.data;
  },

  updateBuilding: async (id: string, payload: Partial<{
    name: string;
    code: string;
    description: string;
    totalFloors: number;
  }>) => {
    const { data } = await apiClient.patch<ApiResponse<Building>>(`/buildings/${id}`, payload);
    return data.data;
  },

  // Soft-delete — the backend keeps the row (isActive: false) rather than
  // dropping it, since bills/memberships may still reference it.
  deleteBuilding: async (id: string): Promise<void> => {
    await apiClient.delete(`/buildings/${id}`);
  },

  getFlats: async (query?: PaginationQuery & { buildingId?: string }) => {
    const { data } = await apiClient.get<PaginatedResponse<Flat>>('/flats', { params: query });
    return data;
  },

  createFlat: async (payload: {
    buildingId: string;
    unitNumber: string;
    flatCode: string;
    area?: number;
    bedrooms?: number;
    bathrooms?: number;
    category?: string;
    status?: string;
    ownershipType?: string;
    parkingSlots?: number;
  }) => {
    const { data } = await apiClient.post<ApiResponse<Flat>>('/flats', payload);
    return data.data;
  },

  updateFlat: async (id: string, payload: Partial<{
    unitNumber: string;
    flatCode: string;
    area: number;
    bedrooms: number;
    bathrooms: number;
    category: string;
    status: string;
    ownershipType: string;
    parkingSlots: number;
  }>) => {
    const { data } = await apiClient.patch<ApiResponse<Flat>>(`/flats/${id}`, payload);
    return data.data;
  },

  deleteFlat: async (id: string): Promise<void> => {
    await apiClient.delete(`/flats/${id}`);
  },

  getMyFlat: async () => {
    const { data } = await apiClient.get<ApiResponse<Flat>>('/flats/my');
    return data.data;
  },

  getAnnouncements: async (query?: PaginationQuery) => {
    const { data } = await apiClient.get<PaginatedResponse<Announcement>>('/announcements', {
      params: query,
    });
    return data;
  },

  getAnnouncement: async (id: string) => {
    const { data } = await apiClient.get<ApiResponse<Announcement>>(`/announcements/${id}`);
    return data.data;
  },

  createAnnouncement: async (payload: {
    title: string;
    content: string;
    priority: string;
    publishAt: string;
    expiresAt?: string;
    audience: string;
  }) => {
    const { data } = await apiClient.post<ApiResponse<Announcement>>('/announcements', payload);
    return data.data;
  },

  getMeetings: async (query?: PaginationQuery) => {
    const { data } = await apiClient.get<PaginatedResponse<Meeting>>('/meetings', {
      params: query,
    });
    return data;
  },

  // ─── Join code ─────────────────────────────────────────────────────────────

  /**
   * Resident-safe financial transparency — any authenticated member can call
   * this; every figure is gated server-side by the corresponding
   * show*ToResidents config flag, so a resident only ever sees what the
   * admin has switched on in Society Settings.
   *
   * Requires the backend change in this same change set to be deployed —
   * on an older API build this 404s, which callers should treat as "not
   * available yet" rather than an error.
   */
  getFinancialSummary: async () => {
    const { data } = await apiClient.get<ApiResponse<{
      showBalances: boolean;
      showExpenses: boolean;
      totalBalance: number | null;
      monthlyExpenses: number | null;
      // Folds SalaryRecord (a separate ledger from Expense) in as a "Staff
      // Salaries" row — same shape as the admin monthly-overview report.
      byCategory: Array<{ category: string; total: number }> | null;
    }>>('/societies/my/financial-summary');
    return data.data;
  },

  getSocietyConfig: async () => {
    const { data } = await apiClient.get<ApiResponse<Record<string, any>>>('/societies/my/config');
    return data.data;
  },

  /** Return the current join/invite code for this society (admin only). */
  getJoinCode: async (): Promise<{ joinCode: string; generatedAt: string | null }> => {
    const { data } = await apiClient.get<ApiResponse<{ joinCode: string; generatedAt: string | null }>>(
      '/societies/my/join-code',
    );
    return data.data;
  },

  /** Rotate the join code — old code is immediately invalidated (admin only). */
  regenerateJoinCode: async (): Promise<{ joinCode: string; generatedAt: string }> => {
    const { data } = await apiClient.patch<ApiResponse<{ joinCode: string; generatedAt: string }>>(
      '/societies/my/regenerate-join-code',
    );
    return data.data;
  },

  /**
   * Admin: list all society members (residents, staff, admins).
   *
   * UsersService.findBySociety returns raw User rows with a nested
   * `memberships` array (a user can hold more than one — the seeded demo
   * accountant has two) — never the flat {displayName, flatNumber,
   * buildingName, role} shape this call used to assume. That mismatch made
   * every row's `role` genuinely undefined, and residents.tsx calls
   * `role.replace(...)` unconditionally in roleLabel() — a real, throwing
   * crash on every load, not just a display bug. admin/settings/roles.tsx
   * already reads the real shape correctly (`memberships?.[0]?.role`);
   * this mirrors that and maps it into the flat shape the UI wants.
   */
  getResidents: async (query?: PaginationQuery & { buildingId?: string; flatId?: string }) => {
    const { data } = await apiClient.get<{
      success: boolean;
      data: Array<{
        id: string;
        email: string;
        phone: string | null;
        firstName: string;
        lastName: string;
        memberships: Array<{
          role: string;
          status: string;
          flat: { id: string; flatCode: string } | null;
        }>;
      }>;
      meta: { total: number; page: number; limit: number; totalPages: number };
    }>('/users/society', { params: query });

    const rows = data?.data ?? [];
    const mapped = rows.map((u) => {
      const m = u.memberships?.[0];
      return {
        id: u.id,
        userId: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        displayName: `${u.firstName} ${u.lastName}`.trim(),
        email: u.email,
        phone: u.phone,
        flatNumber: m?.flat?.flatCode ?? '—',
        buildingName: '',
        role: m?.role ?? 'RESIDENT',
        status: m?.status ?? 'ACTIVE',
      };
    });

    return {
      success: true as const,
      data: mapped,
      meta: data?.meta ?? { total: mapped.length, page: 1, limit: mapped.length, totalPages: 1 },
    };
  },

  // Matches web's Edit Resident modal exactly — email is deliberately not
  // editable here (PATCH /users/:id would accept it, but changing a login
  // identifier needs its own confirmation flow neither client has built).
  updateResident: async (userId: string, payload: { firstName?: string; lastName?: string; phone?: string }) => {
    const { data } = await apiClient.patch<ApiResponse<{ id: string }>>(`/users/${userId}`, payload);
    return data.data;
  },

  /** Join requests onto a flat that already had an active resident — see
   *  AuthService.joinSociety(). Awaiting admin approve/reject. */
  getPendingApprovals: async () => {
    const { data } = await apiClient.get<ApiResponse<Array<{
      id: string;
      joinedAt: string;
      user: { id: string; firstName: string; lastName: string; email: string; phone: string | null };
      flat: { id: string; flatCode: string; unitNumber: string; building: { name: string } | null } | null;
    }>>>('/users/society/pending');
    return data.data ?? [];
  },

  approvePendingMembership: async (membershipId: string) => {
    const { data } = await apiClient.post<ApiResponse<{ id: string }>>(`/users/society/pending/${membershipId}/approve`);
    return data.data;
  },

  rejectPendingMembership: async (membershipId: string) => {
    await apiClient.post(`/users/society/pending/${membershipId}/reject`);
  },
};
