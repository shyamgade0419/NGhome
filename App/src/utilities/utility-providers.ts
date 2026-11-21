/**
 * The electricity companies a flat can pick, each with its main website for paying. They are links the resident opens in their
 * own browser: NG Home does not talk to these companies, fetch bills or take payments. The list lives on the server, so a
 * wrong or moved address can be corrected without a new app. "Other" lets a resident name their company and give its own link.
 *
 * These are each company's main address; confirm and correct them before relying on them.
 */
export interface UtilityProvider {
  code: string;
  name: string;
  /** Where it supplies, for the picker. */
  region: string;
  /** Its main website (https). */
  url: string;
}

export const ELECTRICITY_PROVIDERS: readonly UtilityProvider[] = [
  { code: 'TGSPDCL', name: 'TGSPDCL (Southern Power, Telangana)', region: 'Telangana', url: 'https://tgsouthernpower.org' },
  { code: 'TGNPDCL', name: 'TGNPDCL (Northern Power, Telangana)', region: 'Telangana', url: 'https://tgnpdcl.com' },
  { code: 'APSPDCL', name: 'APSPDCL (Southern Power, Andhra Pradesh)', region: 'Andhra Pradesh', url: 'https://www.apspdcl.in' },
  { code: 'APEPDCL', name: 'APEPDCL (Eastern Power, Andhra Pradesh)', region: 'Andhra Pradesh', url: 'https://www.apeasternpower.com' },
  { code: 'BESCOM', name: 'BESCOM (Bengaluru)', region: 'Karnataka', url: 'https://bescom.karnataka.gov.in' },
  { code: 'TNPDCL', name: 'TNPDCL (Tamil Nadu)', region: 'Tamil Nadu', url: 'https://www.tnpdcl.org' },
  { code: 'KSEB', name: 'KSEB (Kerala)', region: 'Kerala', url: 'https://www.kseb.in' },
  { code: 'MSEDCL', name: 'MSEDCL / Mahavitaran (Maharashtra)', region: 'Maharashtra', url: 'https://www.mahadiscom.in' },
  { code: 'ADANI_MUMBAI', name: 'Adani Electricity (Mumbai)', region: 'Maharashtra', url: 'https://www.adanielectricity.com' },
  { code: 'TORRENT', name: 'Torrent Power', region: 'Gujarat and others', url: 'https://www.torrentpower.com' },
  { code: 'BSES', name: 'BSES Rajdhani / Yamuna (Delhi)', region: 'Delhi', url: 'https://www.bsesdelhi.com' },
  { code: 'TATA_DDL', name: 'Tata Power-DDL (Delhi)', region: 'Delhi', url: 'https://www.tatapower-ddl.com' },
];

export const OTHER_PROVIDER = 'OTHER';

export const providerByCode = (code: string): UtilityProvider | undefined => ELECTRICITY_PROVIDERS.find((p) => p.code === code);
