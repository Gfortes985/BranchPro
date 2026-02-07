/// <reference types="vite/client" />

declare global {
  interface Window {
    branchpro: {
      pickMedia: () => Promise<string | null>;
      mediaUrl: (absPath: string) => string;
    };
  }
}
export {};
