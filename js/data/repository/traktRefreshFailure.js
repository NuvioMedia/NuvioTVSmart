/**
 * Decides whether a failed Trakt token refresh means the stored refresh token itself is no longer
 * usable. Trakt replies 400 (invalid_grant) when the refresh token is revoked or expired, and 401
 * or 403 when it is otherwise rejected. In all three cases the saved credentials are dead, so they
 * must be cleared and the user asked to reconnect instead of retrying with the same dead token.
 * This matches the Android app.
 */

export function isTraktRefreshTokenRejected(status) {
  return status === 400 || status === 401 || status === 403;
}
