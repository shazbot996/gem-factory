import { useState } from 'react';

const MAX_INSTRUCTION_LENGTH = 100 * 1024; // 100KB

interface ManualImportFormProps {
  onImport: (
    gems: { name: string; instructions: string; source: string }[],
  ) => Promise<void>;
  loading: boolean;
}

export default function ManualImportForm({
  onImport,
  loading,
}: ManualImportFormProps) {
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [errors, setErrors] = useState<{ name?: string; instructions?: string }>({});

  function validate(): boolean {
    const newErrors: typeof errors = {};
    if (!name.trim()) newErrors.name = 'Name is required';
    if (!instructions.trim()) newErrors.instructions = 'Instructions are required';
    if (instructions.length > MAX_INSTRUCTION_LENGTH)
      newErrors.instructions = `Instructions must be under ${MAX_INSTRUCTION_LENGTH / 1024}KB`;
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    await onImport([{ name: name.trim(), instructions: instructions.trim(), source: 'manual' }]);
    setName('');
    setInstructions('');
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Gem Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          placeholder="e.g., Code Reviewer"
        />
        {errors.name && (
          <p className="text-red-600 text-sm mt-1">{errors.name}</p>
        )}
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Instructions
        </label>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={8}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono text-sm"
          placeholder="Paste the gem's system instructions here..."
        />
        {errors.instructions && (
          <p className="text-red-600 text-sm mt-1">{errors.instructions}</p>
        )}
      </div>
      <button
        type="submit"
        disabled={loading}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
      >
        {loading ? 'Importing...' : 'Import Gem'}
      </button>
    </form>
  );
}
