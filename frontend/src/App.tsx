import { createBrowserRouter, Link, RouterProvider } from "react-router";
import { lazy } from "react";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { authEnabled } from "./auth/supabase";
import { Layout, Page } from "./components/Layout";
import type { ReactNode } from "react";

// Route components load on first visit. The home shell does not need Konva or quiz code.
const AiCaptionsPage = lazy(() => import("./pages/AiCaptionsPage").then((m) => ({ default: m.AiCaptionsPage })));
const ArtistPage = lazy(() => import("./pages/ArtistPage").then((m) => ({ default: m.ArtistPage })));
const ArtistsPage = lazy(() => import("./pages/ArtistsPage").then((m) => ({ default: m.ArtistsPage })));
const ChoosePaintingPage = lazy(() => import("./pages/ChoosePaintingPage").then((m) => ({ default: m.ChoosePaintingPage })));
const CreatePhrasePage = lazy(() => import("./pages/CreatePhrasePage").then((m) => ({ default: m.CreatePhrasePage })));
const EditMemePage = lazy(() => import("./pages/EditMemePage").then((m) => ({ default: m.EditMemePage })));
const GalleryPage = lazy(() => import("./pages/GalleryPage").then((m) => ({ default: m.GalleryPage })));
const HomePage = lazy(() => import("./pages/HomePage").then((m) => ({ default: m.HomePage })));
const MemeViewPage = lazy(() => import("./pages/MemeViewPage").then((m) => ({ default: m.MemeViewPage })));
const MyMemesPage = lazy(() => import("./pages/MyMemesPage").then((m) => ({ default: m.MyMemesPage })));
const OwnCaptionPage = lazy(() => import("./pages/OwnCaptionPage").then((m) => ({ default: m.OwnCaptionPage })));
const PhraseResultPage = lazy(() => import("./pages/PhraseResultPage").then((m) => ({ default: m.PhraseResultPage })));
const QuizPage = lazy(() => import("./pages/QuizPage").then((m) => ({ default: m.QuizPage })));
const QuizPlayPage = lazy(() => import("./pages/QuizPlayPage").then((m) => ({ default: m.QuizPlayPage })));

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
