/**
 * Signup Page — user self-registration with plan selection
 */

import { SignupForm } from "@/components/signup-form";

export default function SignupPage() {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      {/* Left column - brand */}
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="/" className="flex items-center gap-2 font-medium">
            <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-4"
                aria-label="ZC8 logo"
                role="img"
              >
                <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
              </svg>
            </div>
            ZC8 Platform
          </a>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <SignupForm />
          </div>
        </div>
      </div>

      {/* Right column - decorative */}
      <div className="bg-muted relative hidden lg:block">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-10 text-muted-foreground">
          <blockquote className="space-y-2 text-center max-w-md">
            <p className="text-lg font-medium text-foreground">
              &ldquo;ZC8 gives us real-time visibility into every device across
              our entire fleet — from the edge to the cloud.&rdquo;
            </p>
            <footer className="text-sm">Platform Admin</footer>
          </blockquote>
        </div>
      </div>
    </div>
  );
}
