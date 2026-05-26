/**
 * Inject JSON-LD schema into the page <head> as a script tag.
 * Use server-side: <JsonLd data={buildGraph(...nodes)} />
 */
export function JsonLd({ data }: { data: string }) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: data }}
    />
  );
}
