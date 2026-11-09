import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * Navigates (replacing the current entry) once `to` is set. An effect on the stable router
 * object instead of `<Navigate>`: it fires once per target, never in a render loop.
 */
export function useRedirect(to: string | null): void {
  const router = useRouter();

  useEffect(() => {
    if (to !== null) {
      void router.navigate({ to, replace: true });
    }
  }, [router, to]);
}
