import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { reportQueryError } from '@/lib/queryErrors';
import { Root } from './Root';
// Fonts ship with the app (no request to Google Fonts): it works the same on
// an isolated network. Vazirmatn covers Persian text.
import '@fontsource-variable/inter';
import '@fontsource-variable/vazirmatn';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './index.css';

const queryClient = new QueryClient({
  // A page whose data can't be loaded says so, instead of looking empty
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (!query.meta?.silent) reportQueryError(error);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
});

// A data router (with the routes still declared in App) so pages can hold a
// navigation back while there are unsaved changes
const router = createBrowserRouter([{ path: '*', element: <Root /> }]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
