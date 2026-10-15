import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ThemeProvider, ThemeToggle } from './context/ThemeContext.jsx';
import { firebaseConfigured } from './firebase.js';
import SetupRequired from './pages/SetupRequired.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { HouseholdProvider, useHousehold } from './context/HouseholdContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import Layout from './components/Layout.jsx';
import { Spinner } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Expenses from './pages/Expenses.jsx';
import Balances from './pages/Balances.jsx';
import Bills from './pages/Bills.jsx';
import Chores from './pages/Chores.jsx';
import Groceries from './pages/Groceries.jsx';
import Activity from './pages/Activity.jsx';
import Reports from './pages/Reports.jsx';
import Members from './pages/Members.jsx';
import Settings from './pages/Settings.jsx';
import Notifications from './pages/Notifications.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Checking session…" />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function HouseholdGate({ children }) {
  const { memberships, error } = useHousehold();
  if (error) return <div className="auth-screen"><div className="card"><h1>Firebase needs attention</h1><p className="error-text">{error.message}</p><p>Enable Cloud Firestore and deploy the project rules and indexes. Your browser-local data has not been deleted or uploaded.</p><a className="btn btn-secondary" href="/account">Account settings</a></div></div>;
  if (memberships === null) return <Spinner label="Loading your households…" />;
  if (memberships.length === 0) return <Navigate to="/onboarding" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/account" element={<Protected><Settings /></Protected>} />
      <Route
        path="/onboarding"
        element={
          <Protected>
            <Onboarding />
          </Protected>
        }
      />
      <Route
        path="/*"
        element={
          <Protected>
            <HouseholdGate>
              <Layout>
                <Routes>
                  <Route index element={<Dashboard />} />
                  <Route path="expenses" element={<Expenses />} />
                  <Route path="balances" element={<Balances />} />
                  <Route path="bills" element={<Bills />} />
                  <Route path="chores" element={<Chores />} />
                  <Route path="groceries" element={<Groceries />} />
                  <Route path="activity" element={<Activity />} />
                  <Route path="reports" element={<Reports />} />
                  <Route path="members" element={<Members />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="notifications" element={<Notifications />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Layout>
            </HouseholdGate>
          </Protected>
        }
      />
    </Routes>
  );
}

function FloatingTheme() {
  const { pathname } = useLocation();
  return ['/login', '/register', '/forgot-password', '/onboarding', '/account'].includes(pathname) || !firebaseConfigured ? <div className="global-theme"><ThemeToggle /></div> : null;
}
export default function App() {
  return (
    <ThemeProvider>
    <FloatingTheme />
    {!firebaseConfigured ? <SetupRequired /> :
    <ToastProvider>
      <AuthProvider>
        <HouseholdProvider>
          <AppRoutes />
        </HouseholdProvider>
      </AuthProvider>
    </ToastProvider>}
    </ThemeProvider>
  );
}
