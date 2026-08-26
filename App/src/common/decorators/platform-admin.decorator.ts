import { SetMetadata } from '@nestjs/common';

export const IS_PLATFORM_ADMIN_KEY = 'isPlatformAdmin';
export const PlatformAdmin = () => SetMetadata(IS_PLATFORM_ADMIN_KEY, true);
