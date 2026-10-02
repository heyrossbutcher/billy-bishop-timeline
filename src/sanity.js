import { createClient } from '@sanity/client';

const client = createClient({
  projectId: 'er1m8omu',
  dataset: 'production',
  apiVersion: '2024-01-01',
  useCdn: true,
});

export async function fetchEvents() {
  return client.fetch(
    `*[_type == "event"] | order(year asc) { year, month, title, description, status, source, sourceUrl }`
  );
}
