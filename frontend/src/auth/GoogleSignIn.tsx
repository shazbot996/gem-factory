import { useRef, useEffect } from 'react';

export function GoogleSignIn() {
  const buttonRef = useRef<HTMLDivElement>(null);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!clientId || !buttonRef.current) return;

    const renderButton = () => {
      if (typeof google !== 'undefined' && google.accounts?.id) {
        google.accounts.id.renderButton(buttonRef.current!, {
          theme: 'outline',
          size: 'large',
        });
      } else {
        setTimeout(renderButton, 100);
      }
    };

    renderButton();
  }, [clientId]);

  if (!clientId) return null;

  return <div ref={buttonRef} />;
}
