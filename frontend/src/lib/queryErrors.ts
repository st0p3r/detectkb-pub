import { apiErrorMessage } from '@/lib/api';

export const QUERY_ERROR_EVENT = 'detectkb:query-error';

/** Called for every failed data request (see main.tsx). */
export function reportQueryError(error: unknown) {
  const status = (error as { response?: { status?: number } })?.response?.status;
  // 401 signs the user out, 403 on a forced password change redirects: both explain themselves
  if (status === 401 || status === 403) return;
  const offline = !(error as { response?: unknown })?.response;
  const message = offline ? 'The server cannot be reached. Check the connection and try again.' : apiErrorMessage(error, 'Could not load the data');
  window.dispatchEvent(new CustomEvent(QUERY_ERROR_EVENT, { detail: message }));
}

