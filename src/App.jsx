import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import ProtectedAdminRoute from './components/ProtectedAdminRoute';
import { RouteLoader } from './components/Feedback';
import { AuthProvider } from './context/AuthContext';
import { ShopProvider } from './context/ShopContext';

const HomePage = lazy(() => import('./pages/HomePage'));
const ShopPage = lazy(() => import('./pages/ShopPage'));
const ProductPage = lazy(() => import('./pages/ProductPage'));
const CartPage = lazy(() => import('./pages/CartPage'));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'));
const CustomOrderPage = lazy(() => import('./pages/CustomOrderPage'));
const CorporatePage = lazy(() => import('./pages/CorporatePage'));
const StoryPage = lazy(() => import('./pages/StoryPage'));
const ContactPage = lazy(() => import('./pages/ContactPage'));
const CarePage = lazy(() => import('./pages/CarePage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ShopProvider>
            <Suspense fallback={<RouteLoader />}>
              <Routes>
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
                  <Route path="account" element={<AccountPage />} />
                  <Route
                    path="admin/*"
                    element={<ProtectedAdminRoute><AdminPage /></ProtectedAdminRoute>}
                  />
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
