import React from "react";
import { Routes, Route, useLocation, Navigate } from "react-router-dom";

import Sidebar from "./components/Sidebar";
import Navbar from "./components/Navbar";

import Dashboard from "./pages/Dashboard";
import Inventory from "./pages/Inventory";
import AddProduct from "./pages/AddProduct";
import Report from "./pages/Report";
import SettingsPage from "./pages/Setting";
import ExportPage from "./pages/Export";
import Login from "./pages/Login";
import Signup from "./pages/Signup";

export default function App() {
  const location = useLocation();

  // ✅ Check login status
  const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";

  // Titles for navbar
  const titles = {
    "/dashboard": "Dashboard",
    "/inventory": "Inventory",
    "/add-product": "Add Product",
    "/report": "Reports",
    "/settings": "Settings",
    "/export": "Export Data",
  };

  const path = location.pathname.replace(/\/$/, "");

  // Auth pages check
  const isAuthPage = ["/login", "/signup"].includes(path);

  // ✅ Protected Route wrapper
  const ProtectedRoute = ({ children }) => {
    return isLoggedIn ? children : <Navigate to="/login" />;
  };

  return (
    <>
      {isAuthPage ? (
        // 🔐 AUTH PAGES
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="*" element={<Navigate to="/login" />} />
        </Routes>
      ) : (
        // 🧩 MAIN APP
        <div className="flex min-h-screen bg-slate-100">
          
          {/* Sidebar */}
          <div className="w-64 fixed h-full bg-white shadow">
            <Sidebar />
          </div>

          {/* Main Content */}
          <div className="flex-1 ml-64">
            
            {/* Navbar */}
            <Navbar title={titles[path] || "Dashboard"} />

            {/* Pages */}
            <div className="p-6">
              <Routes>
                
                {/* ✅ FIXED: Root redirect */}
                <Route
                  path="/"
                  element={
                    <Navigate to={isLoggedIn ? "/dashboard" : "/login"} />
                  }
                />

                {/* ✅ Protected routes */}
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute>
                      <Dashboard />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/inventory"
                  element={
                    <ProtectedRoute>
                      <Inventory />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/add-product"
                  element={
                    <ProtectedRoute>
                      <AddProduct />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/report"
                  element={
                    <ProtectedRoute>
                      <Report />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/settings"
                  element={
                    <ProtectedRoute>
                      <SettingsPage />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/export"
                  element={
                    <ProtectedRoute>
                      <ExportPage />
                    </ProtectedRoute>
                  }
                />

                {/* ✅ Smart fallback */}
                <Route
                  path="*"
                  element={
                    <Navigate to={isLoggedIn ? "/dashboard" : "/login"} />
                  }
                />
              </Routes>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
