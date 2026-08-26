# NG Home Mobile

> **Multi-tenant Apartment Community Management App**  
> Built with Expo + React Native · Powered by NovaGade

---

## One App, All Roles

NG Home is **one application** serving every user:

| Role | Experience |
|---|---|
| `SOCIETY_ADMIN` | Full admin dashboard, billing, payments, expenses, settings |
| `SOCIETY_ACCOUNTANT` | Financial operations, payment approvals |
| `COMMITTEE_MEMBER` | Announcements, meetings |
| `SOCIETY_STAFF` | Limited operational view |
| `RESIDENT` | Personal bills, payments, announcements |

The backend JWT token determines the role. The app shows the appropriate navigation automatically. **No separate admin app. No separate resident app.**

---

## Architecture

```
Auth → Token → Profile → Role → Navigation
```

1. User logs in
2. JWT access token stored in SecureStore
3. On load: profile + memberships fetched
4. If multiple societies → Society Selection screen
5. Role derived from JWT → Admin tabs or Resident tabs rendered

---

## Project Structure

```
nghome-mobile/
├── app/
│   ├── _layout.tsx               # Root: QueryClient + AuthProvider
│   ├── index.tsx                 # Redirect hub (auth/select/app)
│   ├── (auth)/
│   │   ├── login.tsx             # Login screen
│   │   ├── forgot-password.tsx
│   │   └── register/             # Multi-step society registration
│   │       ├── society-info.tsx  # Step 1: Society details
│   │       └── admin-details.tsx # Step 2: Admin account + submit
│   ├── (society-select)/
│   │   └── index.tsx             # Multi-society picker
│   └── (app)/
│       ├── _layout.tsx           # Role-based layout selector
│       ├── admin/                # Admin experience
│       │   ├── index.tsx         # Dashboard
│       │   ├── maintenance/      # Billing periods + bills
│       │   ├── payments/         # Payment approvals
│       │   ├── expenses/         # Expense management
│       │   ├── announcements/    # Announcement management
│       │   └── settings/         # Society settings + profile
│       └── resident/             # Resident experience
│           ├── index.tsx         # Home + current bill
│           ├── maintenance.tsx   # Bill history
│           ├── payments/         # Payment history + submit
│           ├── announcements.tsx # Announcements view
│           └── profile.tsx       # Profile + sign out
├── src/
│   ├── api/
│   │   ├── client.ts             # Axios + automatic token refresh
│   │   └── endpoints/            # Typed API functions per module
│   ├── auth/
│   │   ├── AuthContext.tsx       # Global auth state
│   │   └── token.service.ts      # SecureStore read/write/clear
│   ├── components/
│   │   ├── ui/                   # Button, Input, Card, StatusBadge, etc.
│   │   └── layout/               # SafeScreen, ScreenHeader
│   ├── hooks/                    # useAuth, useIsAdmin, useIsRole
│   ├── theme/                    # Colors, spacing, typography
│   └── types/                    # Shared TypeScript interfaces
├── app.json
├── package.json
└── tsconfig.json
```

---

## Quick Start

### Prerequisites

- Node.js 20+
- Expo CLI: `npm install -g expo-cli`
- Expo Go app on your phone (for development)

### Install

```bash
git clone https://github.com/novagade/nghome-mobile
cd nghome-mobile
npm install
```

### Configure API

Edit `app.json` → `extra.apiBaseUrl`:

```json
"extra": {
  "apiBaseUrl": "http://192.168.x.x:3000/api/v1"
}
```

Use your local machine's IP (not `localhost`) when running on a physical device.

### Start

```bash
npm start
```

Scan the QR code with Expo Go on your phone.

---

## Token Security

- Access tokens and refresh tokens stored via `expo-secure-store` (Keychain on iOS, Keystore on Android)
- Axios interceptor automatically:
  1. Attaches `Authorization: Bearer <token>` to every request
  2. On 401: attempts token refresh
  3. If refresh fails: clears tokens and redirects to login
- Tokens are never stored in AsyncStorage or state

---

## Society Registration Flow

```
Login Screen → Register Society
  Step 1: Society Info (name, address, contact)
  Step 2: Admin Account (name, email, phone, password)
  → API: POST /societies/register (transactional)
  → Tokens received → navigate to app
```

All registration data is held in AsyncStorage between steps and deleted after successful submission.

---

## Building for Production

### Android (APK/AAB)

```bash
npx eas build --platform android
```

### iOS (IPA)

```bash
npx eas build --platform ios
```

### Submit to Stores

```bash
npx eas submit --platform android
npx eas submit --platform ios
```

Configure `eas.json` first with your Apple/Google credentials.

---

## Environment

The API URL is configured in `app.json` extra. For EAS builds, use EAS environment variables:

```bash
eas env:create --name API_BASE_URL --value "https://nghome-api.novagade.in/api/v1"
```

Then reference in `app.json`:

```json
"extra": {
  "apiBaseUrl": "$(API_BASE_URL)"
}
```

---

## What to Commit vs Not Commit

### ✅ Commit
- `app/`, `src/`
- `package.json`, `tsconfig.json`, `app.json`, `babel.config.js`
- `README.md`

### ❌ Do NOT Commit
- `.env` files with real values
- `node_modules/`
- `.expo/`
- `android/`, `ios/` native folders (EAS manages these)
- Signing keys (`.jks`, `.p12`)

---

*NG Home Mobile · Expo + React Native · Powered by NovaGade*
