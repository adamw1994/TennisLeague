const baseUrl = process.argv[2] ?? process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';
const healthUrl = new URL('/api/health', baseUrl).toString();

try {
  const response = await fetch(healthUrl);
  const body = await response.text();
  if (!response.ok) {
    console.error(`container health failed: ${response.status} ${body}`);
    process.exit(1);
  }
  console.log(`container health ok: ${body}`);
} catch (error) {
  console.error('container health request failed', error);
  process.exit(1);
}
