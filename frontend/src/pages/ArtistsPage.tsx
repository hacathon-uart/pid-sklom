/** Artists list (US-09, «Усі автори →»). NOT designed yet — simple placeholder layout. */
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { AuthorCard } from "../components/cards";
import { ErrorMessage, Loading, Page } from "../components/Layout";

export function ArtistsPage() {
  const { data, error, loading, reload } = useApi(() => api.artists(), []);
  return (
    <Page title="Автори" subtitle="Українські художники, чиї твори стали суспільним надбанням">
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorMessage error={error} onRetry={reload} />
      ) : (
        <div className="grid grid-cols-4 gap-10">
          {data!.map((a) => (
            <div key={a.id}>
              <AuthorCard artist={a} />
              <p className="t-small mt-3 text-center text-text-secondary">{a.short_bio}</p>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}
