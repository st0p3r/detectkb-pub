import { ToastProvider } from '@/components/ui/Toast';
import { QueryErrorToasts } from '@/components/ui/QueryErrorToasts';
import App from './App';

/** The app inside the providers that need the router. */
export function Root() {
  return (
    <ToastProvider>
      <QueryErrorToasts />
      <App />
    </ToastProvider>
  );
}
