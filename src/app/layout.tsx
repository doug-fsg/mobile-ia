import type { Metadata, Viewport } from "next";
import { PwaInstall } from "@/components/pwa-install";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cursor Local Remote",
  description: "Controle o Cursor IDE de qualquer dispositivo na sua rede local",
  appleWebApp: {
    capable: true,
    title: "CLR",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0a0a0b",
};

const THEME_INIT_SCRIPT = `
(function(){
  try{
    var t=localStorage.getItem('clr-theme');
    if(t==='light'||t==='dark'){
      document.documentElement.setAttribute('data-theme',t);
      var m=document.querySelector('meta[name="theme-color"]');
      if(m)m.setAttribute('content',t==='light'?'#f7f7f8':'#0a0a0b');
    }
  }catch(e){}
})();`;

const SW_CLEANUP_SCRIPT = `
if('serviceWorker' in navigator){
  navigator.serviceWorker.getRegistrations().then(function(r){
    r.forEach(function(reg){reg.unregister()})
  });
  if(typeof caches!=='undefined'){
    caches.keys().then(function(k){
      k.forEach(function(n){caches.delete(n)})
    })
  }
}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="dark" suppressHydrationWarning>
      <body className="overscroll-none">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: SW_CLEANUP_SCRIPT }} />
        {children}
        <PwaInstall />
      </body>
    </html>
  );
}
