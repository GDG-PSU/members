import type { FormEvent } from 'react';

/**
 * React resets a form once its action finishes, even when the action returned a
 * validation error, which would throw away everything the person typed. Pass the
 * result to a form's `onReset` so only a successful submit clears it.
 */
export function keepValuesOnError(state: { error?: string }) {
  return (event: FormEvent<HTMLFormElement>) => {
    if (state.error) event.preventDefault();
  };
}
