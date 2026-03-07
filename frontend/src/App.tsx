import { BrowserRouter, Route, Routes } from "react-router-dom";
import Shell from "@/components/layout/Shell";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import KeysPage from "@/pages/KeysPage";
import LoginPage from "@/pages/LoginPage";
import LogsPage from "@/pages/LogsPage";
import NotFoundPage from "@/pages/NotFoundPage";
import OverviewPage from "@/pages/OverviewPage";
import ProvidersPage from "@/pages/ProvidersPage";
import RulesPage from "@/pages/RulesPage";

function AppContent() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/providers" element={<ProvidersPage />} />
        <Route path="/rules" element={<RulesPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/keys" element={<KeysPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  );
}
