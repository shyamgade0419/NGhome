// Matches backend Society Prisma model
export interface Society {
  id: string;
  name: string;
  displayName: string | null;
  registrationNumber: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  logoUrl: string | null;
  isActive: boolean;
  createdAt: string;
}

// Matches backend Building Prisma model
export interface Building {
  id: string;
  societyId: string;
  name: string;
  code: string | null;
  description: string | null;
  totalFloors: number | null;
  isActive: boolean;
  createdAt: string;
}

export type FlatStatus = 'ACTIVE' | 'VACANT' | 'UNDER_RENOVATION' | 'INACTIVE';

// Matches backend Flat Prisma model (with building join included by service)
export interface Flat {
  id: string;
  societyId: string;
  buildingId: string;
  floorId: string | null;
  unitNumber: string;
  flatCode: string;
  area: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  category: string | null;
  status: FlatStatus;
  ownershipType: string | null;
  parkingSlots: number;
  isActive: boolean;
  building?: { id: string; name: string; code: string | null };
}

// AnnouncementPriority matches backend enum: LOW | NORMAL | HIGH | URGENT
export type AnnouncementPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

// AnnouncementAudience matches backend enum
export type AnnouncementAudience =
  | 'ALL_RESIDENTS'
  | 'BUILDING'
  | 'BLOCK'
  | 'SPECIFIC_FLATS'
  | 'COMMITTEE'
  | 'STAFF'
  | 'ALL';

// Matches backend Announcement Prisma model
export interface Announcement {
  id: string;
  societyId: string;
  title: string;
  content: string;
  priority: AnnouncementPriority;
  audience: AnnouncementAudience;
  publishAt: string | null;
  expiresAt: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  createdAt: string;
}

// Matches backend Meeting Prisma model (no status field)
export interface Meeting {
  id: string;
  societyId: string;
  title: string;
  meetingDate: string;
  location: string | null;
  agenda: string | null;
  isPublished: boolean;
  createdAt: string;
}

// Matches backend MeetingMinutes Prisma model
export interface MeetingMinutes {
  id: string;
  meetingId: string;
  content: string;
  isPublished: boolean;
  publishedAt: string | null;
  createdAt: string;
}
