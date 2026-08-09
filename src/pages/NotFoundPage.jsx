import { Link } from 'react-router-dom';
import Button from 'react-bootstrap/Button';
import Container from 'react-bootstrap/Container';
import Icon from '../components/Icon';

export default function NotFoundPage() {
  return (
    <Container className="not-found page-section">
      <div className="not-found__number" aria-hidden="true">4<span>✦</span>4</div>
      <p className="eyebrow">A tiny imperfection</p>
      <h1>This page didn’t set quite right.</h1>
      <p>The link may be old, or the one-of-one piece you followed has left the studio.</p>
      <div><Button as={Link} to="/" className="button-burgundy">Return home</Button><Link to="/shop" className="text-link">Browse the collection <Icon name="arrow" /></Link></div>
    </Container>
  );
}
