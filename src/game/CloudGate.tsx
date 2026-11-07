import React, { lazy, Suspense, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

const GameApp = lazy(() => import("./App"));

const SYNC_KEYS = [
  "hoor_game_architect_v3",
  "hoor_last_view_v1",
  "hoor_game_settings_v2",
  "hoor_game_progress_v2",
  "hoor_has_selected_age_v2",
  "hoor_child_profiles_v1",
  "hoor_active_child_profile_v1",
  "hoor_quiz_attempts_v1",
];
const GUEST_KEY = "hoor_guest_mode_v1";
const SYNC_AT_KEY = "hoor_cloud_synced_at_v1";

function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of SYNC_KEYS) {
    const v = localStorage.getItem(k);
    if (v !== null) out[k] = v;
  }
  return out;
}

function mergeJsonObject(localObj: Record<string, any>, remoteObj: Record<string, any>): Record<string, any> {
  const merged = { ...remoteObj, ...localObj };
  const numericKeys = ["unlockedStage", "maxStage", "currentStage", "stars", "coins", "crowns", "score", "xp", "totalCorrect"];
  for (const nk of numericKeys) {
    const lVal = typeof localObj[nk] === "number" ? localObj[nk] : 0;
    const rVal = typeof remoteObj[nk] === "number" ? remoteObj[nk] : 0;
    if (lVal > 0 || rVal > 0) {
      merged[nk] = Math.max(lVal, rVal);
    }
  }

  const arrayKeys = ["completedStages", "badges", "upgrades", "ownedItems", "profiles"];
  for (const ak of arrayKeys) {
    const lArr = Array.isArray(localObj[ak]) ? localObj[ak] : [];
    const rArr = Array.isArray(remoteObj[ak]) ? remoteObj[ak] : [];
    if (lArr.length > 0 || rArr.length > 0) {
      const combined = [...rArr];
      for (const item of lArr) {
        if (typeof item === "object" && item !== null && item.id) {
          if (!combined.some((x) => typeof x === "object" && x !== null && x.id === item.id)) {
            combined.push(item);
          }
        } else if (!combined.includes(item)) {
          combined.push(item);
        }
      }
      merged[ak] = combined;
    }
  }
  return merged;
}

async function pullSave(userId: string) {
  try {
    const { data, error } = await supabase
      .from("game_saves")
      .select("data, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    const localAt = Number(localStorage.getItem(SYNC_AT_KEY)) || 0;
    const remoteAt = data?.updated_at ? new Date(data.updated_at).getTime() || 0 : 0;

    let cloudData: Record<string, string> = {};
    if (data && data.data && typeof data.data === "object") {
      cloudData = data.data as Record<string, string>;
    }

    const mergedData: Record<string, string> = {};
    let shouldPushBack = false;

    for (const key of SYNC_KEYS) {
      const localVal = localStorage.getItem(key);
      const remoteVal = cloudData[key];

      if (key === "hoor_game_architect_v3" || key === "hoor_game_progress_v2") {
        let lObj: Record<string, any> = {};
        let rObj: Record<string, any> = {};
        try { if (localVal) lObj = JSON.parse(localVal); } catch {}
        try { if (remoteVal) rObj = JSON.parse(remoteVal); } catch {}

        if (Object.keys(lObj).length > 0 || Object.keys(rObj).length > 0) {
          const mObj = mergeJsonObject(lObj, rObj);
          const mStr = JSON.stringify(mObj);
          mergedData[key] = mStr;
          localStorage.setItem(key, mStr);
          if (mStr !== remoteVal) {
            shouldPushBack = true;
          }
        }
      } else {
        if (localAt > remoteAt && localVal) {
          mergedData[key] = localVal;
          shouldPushBack = true;
        } else if (remoteVal) {
          mergedData[key] = remoteVal;
          localStorage.setItem(key, remoteVal);
        } else if (localVal) {
          mergedData[key] = localVal;
          shouldPushBack = true;
        }
      }
    }

    const now = Date.now();
    localStorage.setItem(SYNC_AT_KEY, String(now));

    if (shouldPushBack || !data) {
      await pushSave(userId, mergedData);
    }
  } catch (err) {
    console.error("CloudGate pullSave error:", err);
  }
}

async function pushSave(userId: string, customSnapshot?: Record<string, string>) {
  try {
    const payload = customSnapshot || snapshot();
    await supabase.from("game_saves").upsert(
      {
        user_id: userId,
        data: payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
    localStorage.setItem(SYNC_AT_KEY, String(Date.now()));
  } catch (err) {
    console.error("CloudGate pushSave error:", err);
  }
}

export function CloudGate(): React.JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState<boolean>(() => {
    return localStorage.getItem(GUEST_KEY) === "true";
  });
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const [localProgress, setLocalProgress] = useState<{
    stage: number;
    stars: number;
    coins: number;
    crowns: number;
  }>({ stage: 1, stars: 0, coins: 0, crowns: 0 });

  useEffect(() => {
    try {
      const raw = localStorage.getItem("hoor_game_architect_v3") || localStorage.getItem("hoor_game_progress_v2");
      if (raw) {
        const parsed = JSON.parse(raw);
        setLocalProgress({
          stage: parsed.unlockedStage || parsed.maxStage || parsed.currentStage || 1,
          stars: parsed.stars || 0,
          coins: parsed.coins || 0,
          crowns: parsed.crowns || 0,
        });
      }
    } catch {}
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        setSyncStatus("syncing");
        pullSave(session.user.id).then(() => setSyncStatus("synced")).catch(() => setSyncStatus("error"));
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        setIsGuest(false);
        localStorage.removeItem(GUEST_KEY);
        setSyncStatus("syncing");
        pullSave(session.user.id).then(() => setSyncStatus("synced")).catch(() => setSyncStatus("error"));
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setAuthLoading(true);
    try {
      const res = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (res && (res as any).error) {
        await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: window.location.origin },
        });
      }
    } catch {
      try {
        await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: window.location.origin },
        });
      } catch (err: any) {
        setAuthError(err?.message || "تعذر تسجيل الدخول عبر Google");
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      setAuthError(err?.message || "حدث خطأ أثناء تسجيل الدخول");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGuestPlay = () => {
    localStorage.setItem(GUEST_KEY, "true");
    setIsGuest(true);
  };

  const handleManualSave = async (payload?: Record<string, string>) => {
    if (session?.user?.id) {
      setSyncStatus("syncing");
      await pushSave(session.user.id, payload);
      setSyncStatus("synced");
    }
  };

  if (loading) {
    return (
      <div className="w-full h-screen bg-[#0F172A] flex items-center justify-center text-white text-xl font-bold dir-rtl">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
          <p>جاري تحميل أكاديمية حور الفضائية...</p>
        </div>
      </div>
    );
  }

  if (session || isGuest) {
    return (
      <div className="relative w-full h-screen bg-[#0F172A]">
        {/* Floating Cloud Status Pill */}
        <div className="absolute top-3 left-3 z-50 bg-slate-800/90 backdrop-blur-md border border-slate-700 px-3 py-1.5 rounded-full text-xs text-white shadow-lg flex items-center gap-2 dir-rtl">
          {session ? (
            <span>
              {syncStatus === "syncing" && "🔄 جاري الحفظ..."}
              {syncStatus === "synced" && "☁️ محفوظ سحابياً ✓"}
              {syncStatus === "error" && "⚠️ خطأ المزامنة"}
              {syncStatus === "idle" && "☁️ جاهز للمزامنة"}
            </span>
          ) : (
            <button
              onClick={handleGoogleLogin}
              className="flex items-center gap-1.5 text-cyan-300 hover:text-cyan-200 font-medium cursor-pointer"
            >
              <span>🔗 ربط حساب Google لحفظ التقدم</span>
            </button>
          )}
        </div>

        <Suspense
          fallback={
            <div className="w-full h-screen bg-[#0F172A] flex items-center justify-center text-white font-bold dir-rtl">
              جاري تجهيز اللعبة...
            </div>
          }
        >
          <GameApp
            userEmail={session?.user?.email || null}
            userName={session?.user?.user_metadata?.full_name || null}
            isGuest={!session}
            syncStatus={syncStatus}
            onSaveRequested={handleManualSave}
            onLoginRequested={handleGoogleLogin}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div
      className="w-full min-h-screen bg-gradient-to-b from-[#0F172A] via-[#1E1B4B] to-[#311042] text-white flex flex-col items-center justify-center p-4 dir-rtl overflow-y-auto"
      dir="rtl"
    >
      <div className="max-w-md w-full bg-slate-900/80 backdrop-blur-xl border border-slate-700/80 rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col items-center text-center my-6">
        {/* Header Icon */}
        <div className="w-20 h-20 bg-gradient-to-tr from-cyan-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-cyan-500/30 mb-4 animate-bounce">
          <span className="text-4xl">🚀</span>
        </div>

        {/* Title & Subtitle */}
        <h1 className="text-2xl sm:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-sky-200 to-amber-300 mb-2">
          أكاديمية حور الفضائية: العب وتعلّم
        </h1>
        <p className="text-slate-300 text-xs sm:text-sm mb-6">
          مغامرة تفاعلية ممتعة تجمع بين العلوم والمنافسة والقرآن الكريم
        </p>

        {/* Live Local Progress Preview */}
        {localProgress.stage > 1 || localProgress.stars > 0 || localProgress.coins > 0 ? (
          <div className="w-full bg-slate-800/80 border border-amber-500/40 rounded-2xl p-3 mb-5 text-right">
            <div className="text-xs text-amber-400 font-bold mb-1">التقدم المحفوظ محلياً على هذا الجهاز:</div>
            <div className="flex items-center justify-around text-xs font-semibold text-slate-200">
              <span>🚀 المرحلة: {localProgress.stage}</span>
              <span>⭐ {localProgress.stars}</span>
              <span>🪙 {localProgress.coins}</span>
              <span>👑 {localProgress.crowns}</span>
            </div>
          </div>
        ) : null}

        {/* 3 Game Pillars Badges */}
        <div className="w-full flex flex-col gap-2 mb-6">
          <div className="bg-slate-800/60 border border-slate-700 rounded-xl px-3 py-2 text-xs text-cyan-200 font-medium flex items-center justify-center">
            🚀 ٢٣ مرحلة فضائية تفاعلية
          </div>
          <div className="bg-slate-800/60 border border-slate-700 rounded-xl px-3 py-2 text-xs text-amber-200 font-medium flex items-center justify-center">
            🧠 ألغاز علمية وإسلامية وذكاء
          </div>
          <div className="bg-slate-800/60 border border-slate-700 rounded-xl px-3 py-2 text-xs text-emerald-200 font-medium flex items-center justify-center">
            📖 استماع وتدبر القرآن الكريم
          </div>
        </div>

        {/* Auth Error Banner */}
        {authError && (
          <div className="w-full bg-rose-500/20 border border-rose-500/50 text-rose-200 text-xs rounded-xl p-3 mb-4">
            {authError}
          </div>
        )}

        {/* Google One-Tap Auth Button */}
        <button
          onClick={handleGoogleLogin}
          disabled={authLoading}
          className="w-full bg-white hover:bg-slate-100 text-slate-900 font-bold py-3.5 px-4 rounded-2xl shadow-lg transition duration-200 flex items-center justify-center gap-3 mb-3 cursor-pointer disabled:opacity-50"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>الدخول المباشر عبر Google</span>
        </button>

        {/* Toggle Email Form Button */}
        <button
          onClick={() => setShowEmailForm(!showEmailForm)}
          className="text-xs text-slate-400 hover:text-slate-200 underline mb-4 cursor-pointer"
        >
          {showEmailForm ? "إخفاء نموذج البريد الإلكتروني" : "تسجيل الدخول / إنشاء حساب بالبريد الإلكتروني"}
        </button>

        {/* Collapsible Email/Password Form */}
        {showEmailForm && (
          <form onSubmit={handleEmailAuth} className="w-full flex flex-col gap-3 mb-4 text-right">
            <input
              type="email"
              placeholder="البريد الإلكتروني"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-cyan-400"
            />
            <input
              type="password"
              placeholder="كلمة المرور"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-cyan-400"
            />
            <button
              type="submit"
              disabled={authLoading}
              className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-2.5 rounded-xl text-xs transition duration-200 cursor-pointer disabled:opacity-50"
            >
              {isSignUp ? "إنشاء حساب جديد" : "تسجيل الدخول"}
            </button>
            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-xs text-cyan-400 hover:underline text-center cursor-pointer"
            >
              {isSignUp ? "لديك حساب بالفعل؟ سجل الدخول" : "ليس لديك حساب؟ أنشئ حساباً جديداً"}
            </button>
          </form>
        )}

        {/* Divider */}
        <div className="w-full flex items-center gap-3 my-2">
          <div className="flex-1 h-px bg-slate-800"></div>
          <span className="text-xs text-slate-500">أو</span>
          <div className="flex-1 h-px bg-slate-800"></div>
        </div>

        {/* Play as Guest Button */}
        <button
          onClick={handleGuestPlay}
          className="w-full mt-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold py-3 px-4 rounded-2xl text-xs sm:text-sm transition duration-200 cursor-pointer flex items-center justify-center gap-2"
        >
          <span>🎮 العب الآن كزائر (مع إمكانية ربط حسابك لاحقاً)</span>
        </button>
      </div>
    </div>
  );
}

export default CloudGate;
