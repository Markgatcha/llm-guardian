import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ADMIN_KEY_STORAGE_KEY, getStoredAdminKey } from "@/lib/api";

interface AuthContextValue {
  adminKey: string | null;
  setAdminKey: (key: string | null) => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [adminKey, setAdminKeyState] = useState<string | null>(() => getStoredAdminKey());

  const setAdminKey = useCallback((key: string | null) => {
    const nextKey = key?.trim() ?? "";
    if (typeof window !== "undefined") {
      if (nextKey) {
        window.localStorage.setItem(ADMIN_KEY_STORAGE_KEY, nextKey);
      } else {
        window.localStorage.removeItem(ADMIN_KEY_STORAGE_KEY);
      }
    }
    setAdminKeyState(nextKey || null);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === ADMIN_KEY_STORAGE_KEY) {
        setAdminKeyState(event.newValue);
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const value = useMemo(
    () => ({
      adminKey,
      setAdminKey,
      isAuthenticated: Boolean(adminKey),
    }),
    [adminKey, setAdminKey]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }

  return context;
}
