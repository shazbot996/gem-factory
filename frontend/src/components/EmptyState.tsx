import { Link } from 'react-router-dom';

interface EmptyStateProps {
  message: string;
  action?: { label: string; to: string };
}

export default function EmptyState({ message, action }: EmptyStateProps) {
  return (
    <div className="text-center py-12 text-gray-500">
      <p>{message}</p>
      {action && (
        <Link
          to={action.to}
          className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
