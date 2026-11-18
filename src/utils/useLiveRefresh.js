import { useEffect, useRef } from 'react';
import { isUserLoggedIn } from './auth.js';

/**
 * Shared hook for 10-second polling, window-focus refresh,
 * and custom event triggers ('4s_request_change', '4s_exchange_change').
 *
 * Automatically clears interval and listeners when the component unmounts.
 * Only triggers when a user is actively logged in to avoid spamming 401 errors.
 *
 * @param {Function} callback - Function to re-fetch data.
 * @param {number} intervalMs - Polling interval in ms (default 10,000 ms).
 * @param {string[]} extraEvents - Custom event names to listen to.
 */
export const useLiveRefresh = (
  callback,
  intervalMs = 10000,
  extraEvents = ['4s_request_change', '4s_exchange_change']
) => {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    // 1. Initial call (only when logged in)
    if (isUserLoggedIn() && cbRef.current) {
      cbRef.current();
    }

    // 2. Periodic polling interval (only when logged in)
    const intervalId = setInterval(() => {
      if (isUserLoggedIn() && cbRef.current) {
        cbRef.current();
      }
    }, intervalMs);

    // 3. Window focus refresh (only when logged in)
    const handleFocus = () => {
      if (isUserLoggedIn() && cbRef.current) {
        cbRef.current();
      }
    };
    window.addEventListener('focus', handleFocus);

    // 4. Custom event handlers (only when logged in)
    const handlers = extraEvents.map((eventName) => {
      const handler = () => {
        if (isUserLoggedIn() && cbRef.current) {
          cbRef.current();
        }
      };
      window.addEventListener(eventName, handler);
      return { eventName, handler };
    });

    // Cleanup when component unmounts
    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      handlers.forEach(({ eventName, handler }) => {
        window.removeEventListener(eventName, handler);
      });
    };
  }, [intervalMs]);
};

export default useLiveRefresh;
