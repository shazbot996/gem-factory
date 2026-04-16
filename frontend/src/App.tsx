import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { useAuth } from './auth/useAuth';
import { GoogleSignIn } from './auth/GoogleSignIn';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Registry from './pages/Registry';
import GemDetail from './pages/GemDetail';
import NotFound from './pages/NotFound';

function ProtectedRoutes() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading)
    return (
      <div className="flex items-center justify-center h-screen">
        Loading...
      </div>
    );
  if (!isAuthenticated) return <SignInPage />;
  return <Layout />;
}

function SignInPage() {
  const { signInAsDev } = useAuth();
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  return (
    <div className="flex flex-col items-center justify-center h-screen gap-6 bg-gray-50 px-6">
      <img src="/schnucks-logo.png" alt="Schnucks" className="h-12" />
      <h1 className="text-2xl font-bold text-gray-900">Gem Registry</h1>

      {clientId ? (
        <>
          <p className="text-gray-600 text-center">
            Sign in with your Schnucks account or personal Gmail.
          </p>
          <GoogleSignIn />
        </>
      ) : (
        <>
          <div className="max-w-md text-center text-gray-600 space-y-3">
            <p>
              <strong>Developer mode</strong> — Google Sign-In is not configured.
            </p>
            <p className="text-sm">
              Set <code className="bg-gray-200 px-1 rounded">VITE_GOOGLE_CLIENT_ID</code>{' '}
              in <code className="bg-gray-200 px-1 rounded">frontend/.env.development.local</code>{' '}
              and restart the dev server to enable real sign-in.
            </p>
          </div>
          <button
            onClick={signInAsDev}
            className="px-4 py-2 bg-schnucks-red text-white rounded-md hover:bg-schnucks-red-dark font-medium"
          >
            Continue as dev user
          </button>
        </>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<ProtectedRoutes />}>
          <Route index element={<Dashboard />} />
          <Route path="registry" element={<Registry />} />
          <Route path="gems/:id" element={<GemDetail />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  );
}
