export const now = () => new Date().toISOString();

export const nowForPath = () => now().replaceAll(':', '-');

export const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
