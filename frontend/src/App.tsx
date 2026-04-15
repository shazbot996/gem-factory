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
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-6 bg-gray-50">
      <img src="/schnucks-logo.png" alt="Schnucks" className="h-12" />
      <h1 className="text-2xl font-bold text-gray-900">Gem Registry</h1>
      <p className="text-gray-600">
        Sign in with your corporate Google account
      </p>
      <GoogleSignIn />
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
