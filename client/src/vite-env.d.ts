/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
  readonly VITE_LAB1_SERVER_URL?: string;
  readonly VITE_LAB2_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
