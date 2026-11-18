import { createBrowserRouter, Link, RouterProvider } from "react-router";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { authEnabled } from "./auth/supabase";
import { Layout, Page } from "./components/Layout";
import { AiCaptionsPage } from "./pages/AiCaptionsPage";
import { ArtistPage } from "./pages/ArtistPage";
import { ArtistsPage } from "./pages/ArtistsPage";
import { ChoosePaintingPage } from "./pages/ChoosePaintingPage";
import { CreatePhrasePage } from "./pages/CreatePhrasePage";
import { EditMemePage } from "./pages/EditMemePage";
import { GalleryPage } from "./pages/GalleryPage";
import { HomePage } from "./pages/HomePage";
import { MemeViewPage } from "./pages/MemeViewPage";
import { MyMemesPage } from "./pages/MyMemesPage";
import { OwnCaptionPage } from "./pages/OwnCaptionPage";
import { PhraseResultPage } from "./pages/PhraseResultPage";
import { QuizPage } from "./pages/QuizPage";
import { QuizPlayPage } from "./pages/QuizPlayPage";
import type { ReactNode } from "react";

function AccountOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user ? children : <MyMemesPage />;
}

// Screen numbers match docs/design/README.md
const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <HomePage /> }, // 1
      { path: "/create", element: <CreatePhrasePage /> }, // 2
      { path: "/create/result", element: <PhraseResultPage /> }, // 3 + 3b
      { path: "/create/painting", element: <ChoosePaintingPage /> }, // 2b
      { path: "/create/painting/:artworkId/ai", element: <AiCaptionsPage /> }, // 3c
      { path: "/create/painting/:artworkId/own", element: <OwnCaptionPage /> }, // 3d
      ...(authEnabled
        ? [
            { path: "/me", element: <MyMemesPage /> }, // 4
            { path: "/me/memes/:memeId", element: <AccountOnly><MemeViewPage /></AccountOnly> }, // 4b
            { path: "/me/memes/:memeId/edit", element: <AccountOnly><EditMemePage /></AccountOnly> },
          ]
        : [{ path: "/me/*", element: <MyMemesPage /> }]),
      { path: "/m/:memeId", element: <MemeViewPage isPublic /> }, // share link (US-16)
      { path: "/gallery", element: <GalleryPage /> }, // 5
      { path: "/artists", element: <ArtistsPage /> }, // not designed
      { path: "/artists/:slug", element: <ArtistPage /> }, // 5b
      { path: "/quiz", element: <QuizPage /> }, // ADR 0008
      { path: "/quiz/:game", element: <QuizPlayPage /> },
      {
        path: "*",
        element: (
          <Page title="Сторінку не знайдено">
            <Link to="/" className="t-strong text-accent">На головну →</Link>
          </Page>
        ),
      },
    ],
  },
]);

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
