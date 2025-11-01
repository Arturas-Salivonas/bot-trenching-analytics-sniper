/// <reference types="chrome" />
/// <reference types="svelte" />
interface ImportMetaEnv {
	readonly DEV: boolean;
}
interface ImportMeta {
	readonly env: ImportMetaEnv;
}
