/** Artists list (US-09, «Усі автори →»). NOT designed yet — simple placeholder layout. */
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { AuthorCard } from "../components/cards";
import { ErrorMessage, Loading, Page } from "../components/Layout";

export function ArtistsPage() {
  const { data, error, loading, reload } = useApi(() => api.artists(), []);
  return (
    <Page title="Автори">
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorMessage error={error} onRetry={reload} />
      ) : (
        <div className="grid grid-cols-1 gap-8 min-[375px]:grid-cols-2 md:grid-cols-3 md:gap-10 xl:grid-cols-4">
          {data!.map((a) => (
            <div key={a.id} className="min-w-0 break-words">
              <AuthorCard artist={a} />
              <p className="t-small mt-3 text-center text-text-secondary">{a.short_bio}</p>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}
