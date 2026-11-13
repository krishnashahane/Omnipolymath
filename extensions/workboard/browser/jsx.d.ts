import "@solidjs/web";

declare module "@solidjs/web" {
  namespace JSX {
    interface IntrinsicElements {
      "omnipolymath-modal-actions": HTMLAttributes<HTMLElement>;
      "workboard-inline-text": HTMLAttributes<HTMLElement>;
      "omnipolymath-workboard-session-status": HTMLAttributes<HTMLElement>;
      "omnipolymath-workboard-toast": HTMLAttributes<HTMLElement>;
    }
  }
}
