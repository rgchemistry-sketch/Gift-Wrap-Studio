import Button from 'react-bootstrap/Button';
import Spinner from 'react-bootstrap/Spinner';
import Icon from '../Icon';

export default function AdminSectionState({ loading = false, title, message, actionLabel, onAction }) {
  return (
    <div className="admin-section-state" role={loading ? 'status' : undefined}>
      <span className="admin-section-state__mark">
        {loading ? <Spinner animation="border" size="sm" /> : <Icon name="spark" size={24} />}
      </span>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {actionLabel && onAction && (
        <Button type="button" variant="outline-dark" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
