import {
  type AnyRoute,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { ConfirmAccountPage } from "./features/auth/confirm-account-page";
import { ForgotPasswordPage } from "./features/auth/forgot-password-page";
import { ResendConfirmationPage } from "./features/auth/resend-confirmation-page";
import { SignInPage } from "./features/auth/sign-in-page";
import { SignUpPage } from "./features/auth/sign-up-page";
import { getAccessToken } from "./lib/access-token";
import { AppLayout } from "./routes/app-layout";
import { AuthLayout } from "./routes/auth-layout";
import { HomePage } from "./routes/home-page";
import { NotFoundPage } from "./routes/not-found-page";

/** Builds a child route from its parent; lets tests register probe routes in a group. */
export type RouteFactory = (parent: AnyRoute) => AnyRoute;

interface CreateAppRouterOptions {
  history?: RouterHistory;
  extraRoutes?: { auth?: RouteFactory[]; app?: RouteFactory[] };
}

export function createAppRouter({ history, extraRoutes }: CreateAppRouterOptions = {}) {
  const rootRoute = createRootRoute({
    component: Outlet,
    notFoundComponent: NotFoundPage,
  });

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    beforeLoad: () => {
      throw redirect({ to: "/app" });
    },
  });

  // Public group: every page under /auth/*.
  const authRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "auth",
    component: AuthLayout,
  });

  // Private group: every page under /app/*. Without a token the visitor never reaches the layout
  // (and the API is never called); with one, `AppLayout` checks it against the API.
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "app",
    beforeLoad: () => {
      if (getAccessToken() === null) {
        throw redirect({ to: "/auth/sign-in", replace: true });
      }
    },
    component: AppLayout,
  });

  const signInRoute = createRoute({
    getParentRoute: () => authRoute,
    path: "sign-in",
    component: SignInPage,
  });

  const signUpRoute = createRoute({
    getParentRoute: () => authRoute,
    path: "sign-up",
    component: SignUpPage,
  });

  const forgotPasswordRoute = createRoute({
    getParentRoute: () => authRoute,
    path: "forgot-password",
    component: ForgotPasswordPage,
  });

  const confirmAccountRoute = createRoute({
    getParentRoute: () => authRoute,
    path: "confirm-account",
    component: ConfirmAccountPage,
  });

  const resendConfirmationRoute = createRoute({
    getParentRoute: () => authRoute,
    path: "resend-confirmation",
    component: ResendConfirmationPage,
  });

  const homeRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/",
    component: HomePage,
  });

  const routeTree = rootRoute.addChildren([
    indexRoute,
    authRoute.addChildren([
      signInRoute,
      signUpRoute,
      forgotPasswordRoute,
      confirmAccountRoute,
      resendConfirmationRoute,
      ...(extraRoutes?.auth?.map((create) => create(authRoute)) ?? []),
    ]),
    appRoute.addChildren([
      homeRoute,
      ...(extraRoutes?.app?.map((create) => create(appRoute)) ?? []),
    ]),
  ]);

  return createRouter({ routeTree, history });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

/**
 * Leaves for the sign-in page when the API says the session is gone. Auth pages stay
 * where they are: a stale token must not push someone off the sign-up page.
 */
export function redirectToSignIn(router: AppRouter): void {
  if (!router.state.location.pathname.startsWith("/auth")) {
    void router.navigate({ to: "/auth/sign-in", replace: true });
  }
}
