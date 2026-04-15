import { useState, useEffect } from 'react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function SearchBar({
  value,
  onChange,
  placeholder = 'Search gems...',
}: SearchBarProps) {
  const [input, setInput] = useState(value);

  useEffect(() => {
    setInput(value);
  }, [value]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (input !== value) {
        onChange(input);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [input, value, onChange]);

  return (
    <input
      type="text"
      value={input}
      onChange={(e) => setInput(e.target.value)}
      placeholder={placeholder}
      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-schnucks-red focus:border-schnucks-red outline-none"
    />
  );
}
