import { BrowserRouter, Route, Routes } from "react-router-dom";

import { ToastProvider } from "./components/Toast";
import { Dashboard } from "./pages/Dashboard";
import { ProductDetail } from "./pages/ProductDetail";
import { Settings } from "./pages/Settings";

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/products/:id" element={<ProductDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route
            path="*"
            element={
              <div className="grid min-h-screen place-items-center px-6 text-center">
                <div>
                  <h1 className="font-display text-3xl">Seite nicht gefunden</h1>
                  <a href="/" className="btn mt-4 inline-flex">Zur Übersicht</a>
                </div>
              </div>
            }
          />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
