import { Navigate, useLocation } from 'react-router-dom';
import Button from 'react-bootstrap/Button';
import Container from 'react-bootstrap/Container';
import Icon from './Icon';
import { RouteLoader } from './Feedback';
import { useAuth } from '../context/AuthContext';

export default function ProtectedAdminRoute({ children }) {
  const { user, loading, openAuth } = useAuth();
  const location = useLocation();

  if (loading) return <RouteLoader />;
  if (!user) {
    return (
      <Container className="access-state page-section">
        <div className="access-state__icon"><Icon name="lock" size={30} /></div>
        <p className="eyebrow">Protected workspace</p>
        <h1>Studio admin sign-in required.</h1>
        <p>Use Google or the secure code sent to the studio administrator email. Buyer accounts cannot access this area.</p>
        <Button className="button-burgundy" onClick={() => openAuth('Use the studio administrator Google account or email verification code to continue.', 'login')}>Sign in securely</Button>
      </Container>
    );
  }

  if (user.role !== 'admin') {
    return <Navigate to="/account" replace state={{ deniedFrom: location.pathname }} />;
  }

  return children;
}
