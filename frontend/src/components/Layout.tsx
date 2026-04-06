import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded-md text-sm font-medium ${
    isActive
      ? 'bg-blue-100 text-blue-700'
      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
  }`;

export default function Layout() {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-6">
              <NavLink to="/" className="text-xl font-bold text-gray-900">
                Gem Factory
              </NavLink>
              <nav className="flex gap-1">
                <NavLink to="/" end className={linkClass}>
                  Dashboard
                </NavLink>
                <NavLink to="/import" className={linkClass}>
                  Import
                </NavLink>
                <NavLink to="/registry" className={linkClass}>
                  Registry
                </NavLink>
              </nav>
            </div>
            <div className="flex items-center gap-3">
              {user?.picture && (
                <img
                  src={user.picture}
                  alt=""
                  className="w-8 h-8 rounded-full"
                />
              )}
              <span className="text-sm text-gray-700">{user?.name}</span>
              <button
                onClick={signOut}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
}
