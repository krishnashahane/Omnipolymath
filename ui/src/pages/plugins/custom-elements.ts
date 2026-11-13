import "@solidjs/web";

// The remaining custom elements own their children and behavior during the page cutover.
declare module "@solidjs/web" {
  namespace JSX {
    interface IntrinsicElements {
      "omnipolymath-plugin-manager": HTMLAttributes<HTMLElement>;
      "omnipolymath-plugin-catalog-skeleton": HTMLAttributes<HTMLElement>;
      "omnipolymath-plugin-settings-editor": HTMLAttributes<HTMLElement>;
      "omnipolymath-plugin-credential-editor": HTMLAttributes<HTMLElement>;
    }
  }
}
