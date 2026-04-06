import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4 text-gray-500">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <Link to="/" className="text-blue-600 hover:text-blue-800">
        Back to Dashboard
      </Link>
    </div>
  );
}
