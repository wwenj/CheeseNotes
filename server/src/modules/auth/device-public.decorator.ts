import { SetMetadata } from '@nestjs/common';

export const IS_DEVICE_PUBLIC_ROUTE = 'noteai:device-public-route';
export const DevicePublic = () => SetMetadata(IS_DEVICE_PUBLIC_ROUTE, true);
