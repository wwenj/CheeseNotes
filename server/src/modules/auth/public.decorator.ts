import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_ROUTE = 'noteai:public-route';
export const Public = () => SetMetadata(IS_PUBLIC_ROUTE, true);
