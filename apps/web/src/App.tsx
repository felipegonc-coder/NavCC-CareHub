import { ThemeProvider } from '@carehub/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
// RouterProvider from 'react-router', not 'react-router/dom': under Vitest that one loads a second
// copy of React Router, and nothing renders below an <Outlet />. Only navigate's flushSync is lost.
import { createBrowserRouter, RouterProvider } from 'react-router';
import { createQueryClient } from './api/queryClient';
import { routes } from './routes';

const router = createBrowserRouter(routes);

/** App-wide providers around the router. */
export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
