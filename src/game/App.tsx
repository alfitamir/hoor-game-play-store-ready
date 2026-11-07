import React, { useEffect, useRef } from "react";

export interface GameAppProps {
  userEmail?: string | null;
  userName?: string | null;
  isGuest?: boolean;
  syncStatus?: "idle" | "syncing" | "synced" | "error";
  onSaveRequested?: (payload?: Record<string, string>) => void;
  onLoginRequested?: () => void;
}

export function GameApp({
  userEmail,
  userName,
  isGuest,
  syncStatus = "idle",
  onSaveRequested,
  onLoginRequested,
}: GameAppProps): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const sendAuthToIframe = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      {
        type: "HOOR_AUTH_STATE",
        authenticated: Boolean(userEmail),
        isGuest: Boolean(isGuest),
        userEmail: userEmail || null,
        userName: userName || (userEmail ? userEmail.split("@")[0] : null),
        syncStatus,
      },
      window.location.origin
    );
  };

  useEffect(() => {
    sendAuthToIframe();
  }, [userEmail, userName, isGuest, syncStatus]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const msg = event.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "HOOR_IFRAME_READY") {
        sendAuthToIframe();
      } else if (msg.type === "HOOR_SAVE_PROGRESS") {
        onSaveRequested?.(msg.snapshot);
      } else if (msg.type === "HOOR_REQUEST_GOOGLE_LOGIN") {
        onLoginRequested?.();
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [userEmail, userName, isGuest, syncStatus, onSaveRequested, onLoginRequested]);

  return (
    <div className="w-full h-screen bg-[#0F172A] overflow-hidden flex flex-col" dir="rtl">
      <iframe
        ref={iframeRef}
        onLoad={sendAuthToIframe}
        src="/Hoor-Plays-Learns-Android.html"
        title="لعبة حور: العب وتعلّم"
        className="w-full h-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms"
        referrerPolicy="no-referrer"
        allow="autoplay"
        loading="eager"
      />
    </div>
  );
}

export default GameApp;
