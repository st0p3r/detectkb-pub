import { useToastContext } from '@/components/ui/Toast';

export function useToast() {
  const { toast } = useToastContext();
  return { toast };
}
