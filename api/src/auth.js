export function isAuthorized(request) {
  const secret = process.env.API_SECRET;
  if (!secret) {
    return true;
  }

  const auth = request.headers.authorization || '';
  return auth === `Bearer ${secret}`;
}
