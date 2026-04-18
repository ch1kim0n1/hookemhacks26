/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_SENTINEL_API?: string;
    readonly VITE_SENTINEL_WS?: string;
    readonly VITE_USE_LIVE_TVL?: "1" | "0";
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
