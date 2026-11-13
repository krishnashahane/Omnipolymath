export function channelDocsUrl(channelId: string): string {
  return `https://omnipolymath.vercel.app/docs/channels/${encodeURIComponent(channelId)}`;
}
