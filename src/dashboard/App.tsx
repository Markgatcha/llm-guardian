import { BrowserRouter, Route, Routes } from "react-router-dom";
import Shell from "./components/Shell";
import OverviewPage from "./pages/OverviewPage";
import CompressionPage from "./pages/CompressionPage";
import SavingsPage from "./pages/SavingsPage";
import ProvidersPage from "./pages/ProvidersPage";
import LogsPage from "./pages/LogsPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/compression" element={<CompressionPage />} />
          <Route path="/savings" element={<SavingsPage />} />
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="*" element={<OverviewPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
