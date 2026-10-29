export {};
declare global {
  interface Window {
    clearDesktop?: {minimize:()=>void;maximize:()=>void;close:()=>void};
  }
}
