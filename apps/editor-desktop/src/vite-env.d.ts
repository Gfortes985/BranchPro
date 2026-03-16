/// <reference types="vite/client" />

declare global {
  interface Window {
    branchpro: {
      pickMedia: () => Promise<string | null>;
      mediaUrl: (absPath: string) => string;
      getPathForFile?: (file: File) => string | null;
    };
  }
}
export {};
