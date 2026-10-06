/**
 * The phone app's launch screen (the logo, inline in index.html) goes once the
 * map has drawn; index.html also lets it go after 2.5 s whatever happens.
 */
export function hideLaunch(): void {
  (window as { __mbHideLaunch?: () => void }).__mbHideLaunch?.();
}
