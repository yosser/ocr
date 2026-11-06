/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POCKETBASE_URL?: string
  readonly VITE_POCKETBASE_REQUIRE_AUTH?: string
  readonly VITE_POCKETBASE_USER?: string
  readonly VITE_POCKETBASE_PASSWORD?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
