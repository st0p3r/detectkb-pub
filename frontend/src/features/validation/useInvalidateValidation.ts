import { useQueryClient } from '@tanstack/react-query';

/** Refreshes everything that shows validation after a test result is recorded or deleted. */
export function useInvalidateValidation() {
  const qc = useQueryClient();
  return () => {
    for (const key of ['rule-validation', 'atomic-runs', 'attack-coverage', 'attack-technique-rules', 'data-health']) qc.invalidateQueries({ queryKey: [key] });
  };
}
