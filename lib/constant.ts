/**
 * The backend belongs to this deployment. Set NEXT_PUBLIC_BACKEND_API_URL at
 * build time to the Worker URL; development defaults to the local Worker.
 */
export const BACKEND_API_URL = (
  process.env.NEXT_PUBLIC_BACKEND_API_URL || "http://localhost:8787"
).replace(/\/$/, "");
export const APP_DISPLAY_NAME = "Meeting Copilot";
/** Matches worker MAX_IMAGES_PER_REQUEST — keep in sync. */
export const MAX_IMAGES = 4;
