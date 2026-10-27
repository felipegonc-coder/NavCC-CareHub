import { useToast } from '@carehub/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '../../lib/api';
import { signOut } from './sign-out';

/**
 * Sign out for a menu item or button (see `signOut`). If the server can't be told, a toast says so
 * and the person stays signed in.
 */
export function useSignOut(): () => Promise<void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  return useCallback(async () => {
    try {
      await signOut({ queryClient, navigate: (to, options) => void navigate(to, options) });
    } catch (error) {
      toast({
        title: "Couldn't sign out",
        description: error instanceof ApiError ? error.message : 'Something went wrong. Try again.',
        variant: 'danger',
      });
    }
  }, [queryClient, navigate, toast]);
}
