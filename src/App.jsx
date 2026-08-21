import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AdminShell from './components/AdminShell';
import ErrorBoundary from './components/ErrorBoundary';
import ProtectedAdminRoute from './components/ProtectedAdminRoute';
import { RouteLoader } from './components/Feedback';
import { AuthProvider } from './context/AuthContext';
import { ShopProvider } from './context/ShopContext';

const HomePage = lazy(() => import('./pages/HomePage'));
const Layout = lazy(() => import('./components/Layout'));
const ShopPage = lazy(() => import('./pages/ShopPage'));
const ProductPage = lazy(() => import('./pages/ProductPage'));
const CartPage = lazy(() => import('./pages/CartPage'));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'));
const CustomOrderPage = lazy(() => import('./pages/CustomOrderPage'));
const CorporatePage = lazy(() => import('./pages/CorporatePage'));
const StoryPage = lazy(() => import('./pages/StoryPage'));
const ContactPage = lazy(() => import('./pages/ContactPage'));
const CarePage = lazy(() => import('./pages/CarePage'));
const TermsPage = lazy(() => import('./pages/PolicyPage').then((module) => ({ default: module.TermsPage })));
const PrivacyPage = lazy(() => import('./pages/PolicyPage').then((module) => ({ default: module.PrivacyPage })));
const RefundPolicyPage = lazy(() => import('./pages/PolicyPage').then((module) => ({ default: module.RefundPolicyPage })));
const ShippingPolicyPage = lazy(() => import('./pages/PolicyPage').then((module) => ({ default: module.ShippingPolicyPage })));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const loadAdminPage = () => import('./pages/AdminPage');
const AdminPage = lazy(loadAdminPage);
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function AdminRoute() {
  useEffect(() => {
    // Start downloading the protected workspace while /auth/me is still resolving.
    // React.lazy reuses the same module import when authorization succeeds.
    loadAdminPage().catch(() => {});
  }, []);

  return <ProtectedAdminRoute><AdminPage /></ProtectedAdminRoute>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ShopProvider>
            <Suspense fallback={<RouteLoader />}>
              <Routes>
                <Route element={<AdminShell />}>
                  <Route
                    path="admin/*"
                    element={<AdminRoute />}
                  />
                </Route>
                <Route element={<Layout />}>
                  <Route index element={<HomePage />} />
                  <Route path="shop" element={<ShopPage />} />
                  <Route path="collections" element={<Navigate to="/shop" replace />} />
                  <Route path="product/:slug" element={<ProductPage />} />
                  <Route path="cart" element={<CartPage />} />
                  <Route path="checkout" element={<CheckoutPage />} />
                  <Route path="custom-order" element={<CustomOrderPage />} />
                  <Route path="corporate-gifts" element={<CorporatePage />} />
                  <Route path="our-story" element={<StoryPage />} />
                  <Route path="contact" element={<ContactPage />} />
                  <Route path="care-and-delivery" element={<CarePage />} />
                  <Route path="terms-and-conditions" element={<TermsPage />} />
                  <Route path="privacy-policy" element={<PrivacyPage />} />
                  <Route path="cancellation-and-refund-policy" element={<RefundPolicyPage />} />
                  <Route path="shipping-policy" element={<ShippingPolicyPage />} />
                  <Route path="account" element={<AccountPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Routes>
            </Suspense>
          </ShopProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
