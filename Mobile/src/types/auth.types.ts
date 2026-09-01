export type SystemRole =
  | 'PLATFORM_ADMIN'
  | 'SOCIETY_ADMIN'
  | 'SOCIETY_ACCOUNTANT'
  | 'SOCIETY_STAFF'
  | 'COMMITTEE_MEMBER'
  | 'RESIDENT';

// Matches backend UserDto
export interface User {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  displayName: string;
  isPlatformAdmin: boolean;
  isActive: boolean;
  createdAt: string;
}

// Matches backend MembershipDto
export interface SocietyMembership {
  id: string;
  societyId: string;
  societyName: string;
  societyLogo: string | null;
  role: SystemRole;
  flatId: string | null;
  flatNumber: string | null;
  buildingName: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING';
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// Canonical login/select-society/register-society response shape from backend
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
  memberships: SocietyMembership[];
  requiresSocietySelection?: boolean;
}

export interface AuthenticatedUser extends User {
  currentRole?: SystemRole;
  societyId?: string;
  flatId?: string;
  flatNumber?: string | null;
  buildingName?: string | null;
  membershipId?: string;
  memberships: SocietyMembership[];
}

// Registration payload — matches backend RegisterSocietyDto
export interface RegisterSocietyPayload {
  society: {
    name: string;
    registrationNumber?: string;
    address: string;
    city: string;
    state: string;
    pinCode: string;
    country: string;
    contactEmail: string;
    contactPhone: string;
  };
  admin: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    password: string;
  };
}
