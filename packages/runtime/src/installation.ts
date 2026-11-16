import { fileURLToPath } from "node:url";
/** Root source installation; packaged plugins use their generated captured home. */
export const sourceInstallationRoot = () => fileURLToPath(new URL("../../../", import.meta.url));
