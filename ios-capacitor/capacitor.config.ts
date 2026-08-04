import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.wwenj.noteai.capacitor',
  appName: '芝士笔记',
  webDir: 'www',
  server: {
    iosScheme: 'capacitor',
  },
  plugins: {
    Keyboard: {
      autoBackdropColor: 'dom',
    },
  },
};

export default config;
