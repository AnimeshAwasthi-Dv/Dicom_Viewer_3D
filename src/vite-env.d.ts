/// <reference types="vite/client" />

import 'react';

interface HTMLInputElement {
  webkitdirectory: string;
}

declare module 'react' {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
  }
}
